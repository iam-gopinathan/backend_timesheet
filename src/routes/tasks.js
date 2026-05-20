const express = require('express');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all tasks
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, priority, workspace_id, assignee_id } = req.query;

    let query = `
      SELECT t.*,
             w.name as workspace_name, w.color as workspace_color,
             u.name as assignee_name, u.avatar_url as assignee_avatar,
             ab.name as assigned_by_name
      FROM tasks t
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users ab ON t.assigned_by_id = ab.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Filter by user role
    if (req.user.role === 'employee') {
      query += ` AND t.assignee_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    } else if (req.user.role === 'team_lead') {
      query += ` AND t.assignee_id IN (SELECT id FROM users WHERE team_id = $${paramIndex})`;
      params.push(req.user.team_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      query += ` AND t.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (workspace_id) {
      query += ` AND t.workspace_id = $${paramIndex}`;
      params.push(workspace_id);
      paramIndex++;
    }

    if (assignee_id) {
      query += ` AND t.assignee_id = $${paramIndex}`;
      params.push(assignee_id);
      paramIndex++;
    }

    query += ' ORDER BY t.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tasks'
    });
  }
});

// Get single task
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              w.name as workspace_name, w.color as workspace_color,
              u.name as assignee_name, u.avatar_url as assignee_avatar,
              ab.name as assigned_by_name
       FROM tasks t
       LEFT JOIN workspaces w ON t.workspace_id = w.id
       LEFT JOIN users u ON t.assignee_id = u.id
       LEFT JOIN users ab ON t.assigned_by_id = ab.id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Get comments
    const comments = await pool.query(
      `SELECT c.*, u.name as user_name, u.avatar_url
       FROM task_comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.task_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    // Get time logs
    const timeLogs = await pool.query(
      `SELECT tl.*, u.name as user_name
       FROM time_logs tl
       LEFT JOIN users u ON tl.user_id = u.id
       WHERE tl.task_id = $1
       ORDER BY tl.log_date DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        comments: comments.rows,
        time_logs: timeLogs.rows
      }
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching task'
    });
  }
});

// Create task
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      title,
      description,
      priority,
      workspace_id,
      assignee_id,
      estimated_hours,
      deadline
    } = req.body;

    // Employees can only create tasks for themselves
    if (req.user.role === 'employee' && parseInt(assignee_id) !== parseInt(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Employees can only create tasks for themselves'
      });
    }

    // Get workspace and increment issue number
    const workspaceResult = await pool.query(
      'SELECT project_code, next_issue_number FROM workspaces WHERE id = $1',
      [workspace_id]
    );

    if (workspaceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    const workspace = workspaceResult.rows[0];
    const issueNumber = workspace.next_issue_number;

    // Create task
    const result = await pool.query(
      `INSERT INTO tasks (
        title, description, priority, workspace_id, project_code,
        issue_number, assignee_id, assigned_by_id, estimated_hours, deadline
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        title,
        description,
        priority || 'medium',
        workspace_id,
        workspace.project_code,
        issueNumber,
        assignee_id,
        req.user.id,
        estimated_hours || 0,
        deadline
      ]
    );

    // Increment workspace issue number
    await pool.query(
      'UPDATE workspaces SET next_issue_number = next_issue_number + 1 WHERE id = $1',
      [workspace_id]
    );

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create task error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating task: ' + error.message
    });
  }
});

// Update task
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, description, status, priority, estimated_hours, deadline } = req.body;
    const taskId = req.params.id;

    let completedAt = null;
    if (status === 'done') {
      completedAt = new Date();
    }

    const result = await pool.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           estimated_hours = COALESCE($5, estimated_hours),
           deadline = COALESCE($6, deadline),
           completed_at = $7
       WHERE id = $8
       RETURNING *`,
      [title, description, status, priority, estimated_hours, deadline, completedAt, taskId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating task'
    });
  }
});

// Update task status (drag & drop)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;

    let completedAt = null;
    if (status === 'done') {
      completedAt = new Date();
    }

    const result = await pool.query(
      `UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3 RETURNING *`,
      [status, completedAt, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task status updated',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating task status'
    });
  }
});

// Add comment to task
router.post('/:id/comments', authenticate, async (req, res) => {
  try {
    const { content } = req.body;

    const result = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.id, req.user.id, content]
    );

    res.status(201).json({
      success: true,
      message: 'Comment added',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding comment'
    });
  }
});

// Log time
router.post('/:id/time-log', authenticate, async (req, res) => {
  try {
    const { hours, description, log_date } = req.body;

    // Insert time log
    const result = await pool.query(
      `INSERT INTO time_logs (task_id, user_id, hours, description, log_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, req.user.id, hours, description, log_date || new Date()]
    );

    // Update task logged hours
    await pool.query(
      `UPDATE tasks SET logged_hours = logged_hours + $1 WHERE id = $2`,
      [hours, req.params.id]
    );

    res.status(201).json({
      success: true,
      message: 'Time logged',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Log time error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging time'
    });
  }
});

// Delete task
router.delete('/:id', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting task'
    });
  }
});

// Get task statistics
router.get('/stats/overview', authenticate, async (req, res) => {
  try {
    let whereClause = '';
    const params = [];

    if (req.user.role === 'employee') {
      whereClause = 'WHERE assignee_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'team_lead') {
      whereClause = 'WHERE assignee_id IN (SELECT id FROM users WHERE team_id = $1)';
      params.push(req.user.team_id);
    }

    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'todo') as todo,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'review') as review,
        COUNT(*) FILTER (WHERE status = 'done') as done
       FROM tasks ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
});

module.exports = router;
