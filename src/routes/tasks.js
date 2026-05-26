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

    // Filter by user role
    if (req.user.role === 'employee') {
      query += ` AND t.assignee_id = ?`;
      params.push(req.user.id);
    } else if (req.user.role === 'team_lead') {
      query += ` AND t.assignee_id IN (SELECT id FROM users WHERE team_id = ?)`;
      params.push(req.user.team_id);
    }

    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND t.priority = ?`;
      params.push(priority);
    }

    if (workspace_id) {
      query += ` AND t.workspace_id = ?`;
      params.push(workspace_id);
    }

    if (assignee_id) {
      query += ` AND t.assignee_id = ?`;
      params.push(assignee_id);
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await pool.query(query, params);

    res.json({
      success: true,
      data: rows
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
    const [rows] = await pool.query(
      `SELECT t.*,
              w.name as workspace_name, w.color as workspace_color,
              u.name as assignee_name, u.avatar_url as assignee_avatar,
              ab.name as assigned_by_name
       FROM tasks t
       LEFT JOIN workspaces w ON t.workspace_id = w.id
       LEFT JOIN users u ON t.assignee_id = u.id
       LEFT JOIN users ab ON t.assigned_by_id = ab.id
       WHERE t.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Get comments
    const [comments] = await pool.query(
      `SELECT c.*, u.name as user_name, u.avatar_url
       FROM task_comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.task_id = ?
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    // Get time logs
    const [timeLogs] = await pool.query(
      `SELECT tl.*, u.name as user_name
       FROM time_logs tl
       LEFT JOIN users u ON tl.user_id = u.id
       WHERE tl.task_id = ?
       ORDER BY tl.log_date DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...rows[0],
        comments: comments,
        time_logs: timeLogs
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
    const [workspaceRows] = await pool.query(
      'SELECT project_code, next_issue_number FROM workspaces WHERE id = ?',
      [workspace_id]
    );

    if (workspaceRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    const workspace = workspaceRows[0];
    const issueNumber = workspace.next_issue_number;

    // Create task
    const [result] = await pool.query(
      `INSERT INTO tasks (
        title, description, priority, workspace_id, project_code,
        issue_number, assignee_id, assigned_by_id, estimated_hours, deadline
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      'UPDATE workspaces SET next_issue_number = next_issue_number + 1 WHERE id = ?',
      [workspace_id]
    );

    // Get the created task
    const [tasks] = await pool.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: tasks[0]
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

    await pool.query(
      `UPDATE tasks
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           status = COALESCE(?, status),
           priority = COALESCE(?, priority),
           estimated_hours = COALESCE(?, estimated_hours),
           deadline = COALESCE(?, deadline),
           completed_at = ?
       WHERE id = ?`,
      [title, description, status, priority, estimated_hours, deadline, completedAt, taskId]
    );

    // Get the updated task
    const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: rows[0]
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

    await pool.query(
      `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`,
      [status, completedAt, req.params.id]
    );

    // Get the updated task
    const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task status updated',
      data: rows[0]
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

    const [result] = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, content)
       VALUES (?, ?, ?)`,
      [req.params.id, req.user.id, content]
    );

    // Get the created comment
    const [comments] = await pool.query('SELECT * FROM task_comments WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Comment added',
      data: comments[0]
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
    const [result] = await pool.query(
      `INSERT INTO time_logs (task_id, user_id, hours, description, log_date)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.user.id, hours, description, log_date || new Date()]
    );

    // Update task logged hours
    await pool.query(
      `UPDATE tasks SET logged_hours = logged_hours + ? WHERE id = ?`,
      [hours, req.params.id]
    );

    // Get the created time log
    const [timeLogs] = await pool.query('SELECT * FROM time_logs WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Time logged',
      data: timeLogs[0]
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
    const [result] = await pool.query(
      'DELETE FROM tasks WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
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
      whereClause = 'WHERE assignee_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'team_lead') {
      whereClause = 'WHERE assignee_id IN (SELECT id FROM users WHERE team_id = ?)';
      params.push(req.user.team_id);
    }

    const [rows] = await pool.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) as review,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
       FROM tasks ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: rows[0]
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
