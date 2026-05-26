const express = require('express');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all workspaces
router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id AND status = 'done') as completed_tasks,
              (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
       FROM workspaces w
       ORDER BY w.created_at DESC`
    );

    res.json({
      success: true,
      data: rows
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
    const [rows] = await pool.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id AND status = 'done') as completed_tasks
       FROM workspaces w
       WHERE w.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    // Get members
    const [members] = await pool.query(
      `SELECT u.id, u.name, u.email, u.designation, u.avatar_url
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = ?`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...rows[0],
        members: members
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
    const [existing] = await pool.query(
      'SELECT id FROM workspaces WHERE project_code = ?',
      [project_code.toUpperCase()]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Project code already exists'
      });
    }

    // Create workspace
    const [result] = await pool.query(
      `INSERT INTO workspaces (name, description, project_code, color, icon, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description, project_code.toUpperCase(), color || '#0052CC', icon || 'folder', req.user.id]
    );

    const workspaceId = result.insertId;

    // Get the created workspace
    const [workspaces] = await pool.query('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
    const workspace = workspaces[0];

    // Add members
    if (member_ids && member_ids.length > 0) {
      const memberValues = member_ids.map(() => '(?, ?)').join(', ');
      const memberParams = member_ids.flatMap(userId => [workspaceId, userId]);

      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id) VALUES ${memberValues}`,
        memberParams
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

    await pool.query(
      `UPDATE workspaces
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           color = COALESCE(?, color),
           icon = COALESCE(?, icon)
       WHERE id = ?`,
      [name, description, color, icon, req.params.id]
    );

    // Get the updated workspace
    const [rows] = await pool.query('SELECT * FROM workspaces WHERE id = ?', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      message: 'Workspace updated successfully',
      data: rows[0]
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
      'INSERT IGNORE INTO workspace_members (workspace_id, user_id) VALUES (?, ?)',
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
      'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
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
    const [result] = await pool.query(
      'DELETE FROM workspaces WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
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
