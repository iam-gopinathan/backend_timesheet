const express = require('express');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all workspaces
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id AND status = 'done') as completed_tasks,
              (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count,
              COALESCE(
                (SELECT array_agg(user_id ORDER BY user_id)
                 FROM workspace_members WHERE workspace_id = w.id),
                ARRAY[]::integer[]
              ) as member_ids
       FROM workspaces w
       ORDER BY w.created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get workspaces error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching workspaces'
    });
  }
});

// Get single workspace
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id AND status = 'done') as completed_tasks,
              COALESCE(
                (SELECT array_agg(user_id ORDER BY user_id)
                 FROM workspace_members WHERE workspace_id = w.id),
                ARRAY[]::integer[]
              ) as member_ids
       FROM workspaces w
       WHERE w.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    // Get members
    const members = await pool.query(
      `SELECT u.id, u.name, u.email, u.designation, u.avatar_url
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        members: members.rows
      }
    });
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching workspace'
    });
  }
});

// Create workspace
router.post('/', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    const { name, description, project_code, color, icon, member_ids } = req.body;

    // Check if project code exists
    const existing = await pool.query(
      'SELECT id FROM workspaces WHERE project_code = $1',
      [project_code.toUpperCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Project code already exists'
      });
    }

    // Create workspace
    const result = await pool.query(
      `INSERT INTO workspaces (name, description, project_code, color, icon, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, description, project_code.toUpperCase(), color || '#0052CC', icon || 'folder', req.user.id]
    );

    const workspace = result.rows[0];

    // Add members
    if (member_ids && member_ids.length > 0) {
      const memberValues = member_ids.map(
        (userId, index) => `($1, $${index + 2})`
      ).join(', ');

      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id) VALUES ${memberValues}`,
        [workspace.id, ...member_ids]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Workspace created successfully',
      data: workspace
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating workspace'
    });
  }
});

// Update workspace
router.put('/:id', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    const { name, description, color, icon } = req.body;

    const result = await pool.query(
      `UPDATE workspaces
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           color = COALESCE($3, color),
           icon = COALESCE($4, icon)
       WHERE id = $5
       RETURNING *`,
      [name, description, color, icon, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      message: 'Workspace updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating workspace'
    });
  }
});

// Add member to workspace
router.post('/:id/members', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    const { user_id } = req.body;

    await pool.query(
      'INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, user_id]
    );

    res.json({
      success: true,
      message: 'Member added to workspace'
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding member'
    });
  }
});

// Remove member from workspace
router.delete('/:id/members/:userId', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );

    res.json({
      success: true,
      message: 'Member removed from workspace'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing member'
    });
  }
});

// Delete workspace
router.delete('/:id', authenticate, authorize('management'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM workspaces WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      message: 'Workspace deleted successfully'
    });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting workspace'
    });
  }
});

module.exports = router;
