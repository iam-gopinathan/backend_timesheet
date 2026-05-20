const express = require('express');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all teams
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users WHERE team_id = t.id AND is_active = true) as member_count
       FROM teams t
       ORDER BY t.name`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching teams'
    });
  }
});

// Get single team
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM teams WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    // Get team members
    const members = await pool.query(
      `SELECT id, name, email, role, designation, avatar_url
       FROM users
       WHERE team_id = $1 AND is_active = true
       ORDER BY name`,
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
    console.error('Get team error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching team'
    });
  }
});

// Create team
router.post('/', authenticate, authorize('management'), async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(
      'INSERT INTO teams (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );

    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating team'
    });
  }
});

// Update team
router.put('/:id', authenticate, authorize('management'), async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await pool.query(
      `UPDATE teams
       SET name = COALESCE($1, name),
           description = COALESCE($2, description)
       WHERE id = $3
       RETURNING *`,
      [name, description, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    res.json({
      success: true,
      message: 'Team updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating team'
    });
  }
});

// Delete team
router.delete('/:id', authenticate, authorize('management'), async (req, res) => {
  try {
    // Check if team has members
    const members = await pool.query(
      'SELECT COUNT(*) FROM users WHERE team_id = $1 AND is_active = true',
      [req.params.id]
    );

    if (parseInt(members.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete team with active members'
      });
    }

    const result = await pool.query(
      'DELETE FROM teams WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }

    res.json({
      success: true,
      message: 'Team deleted successfully'
    });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting team'
    });
  }
});

module.exports = router;
