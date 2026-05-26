const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Get all users (management/team_lead only)
router.get('/', authenticate, authorize('management', 'team_lead'), async (req, res) => {
  try {
    const { team_id, role } = req.query;

    let query = `
      SELECT u.id, u.name, u.email, u.role, u.designation, u.team_id,
             u.avatar_url, u.joined_date, u.is_active, t.name as team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (team_id) {
      query += ` AND u.team_id = ?`;
      params.push(team_id);
    }

    if (role) {
      query += ` AND u.role = ?`;
      params.push(role);
    }

    // Team leads can only see their team members
    if (req.user.role === 'team_lead') {
      query += ` AND u.team_id = ?`;
      params.push(req.user.team_id);
    }

    query += ' ORDER BY u.name';

    const [rows] = await pool.query(query, params);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// Get single user
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.designation, u.team_id,
              u.avatar_url, u.phone, u.joined_date, t.name as team_name
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.id
       WHERE u.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

// Create user (management only)
router.post('/', authenticate, authorize('management'), async (req, res) => {
  try {
    const { name, email, password, role, designation, team_id, phone } = req.body;

    // Check if email exists
    const [existingUser] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (name, email, password, role, designation, team_id, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, role || 'employee', designation, team_id, phone]
    );

    // Get the created user
    const [users] = await pool.query(
      'SELECT id, name, email, role, designation, team_id, phone, joined_date FROM users WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: users[0]
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user'
    });
  }
});

// Update user
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, designation, team_id, phone } = req.body;
    const userId = req.params.id;

    // Check if user can update (own profile or management)
    if (req.user.id !== parseInt(userId) && req.user.role !== 'management') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this user'
      });
    }

    await pool.query(
      `UPDATE users
       SET name = COALESCE(?, name),
           designation = COALESCE(?, designation),
           team_id = COALESCE(?, team_id),
           phone = COALESCE(?, phone)
       WHERE id = ?`,
      [name, designation, team_id, phone, userId]
    );

    // Get the updated user
    const [rows] = await pool.query(
      'SELECT id, name, email, role, designation, team_id, phone FROM users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

// Upload avatar
router.post('/:id/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    const userId = req.params.id;

    // Check authorization
    if (req.user.id !== parseInt(userId) && req.user.role !== 'management') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;

    await pool.query(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [avatarUrl, userId]
    );

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: { avatar_url: avatarUrl }
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading avatar'
    });
  }
});

// Admin: reset another user's password (no current-password check).
// Management only. The new password is hashed before storage.
router.post('/:id/reset-password', authenticate, authorize('management'), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password is required and must be at least 6 characters'
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id, email, name',
      [hashed, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password'
    });
  }
});

// Delete user (management only)
router.delete('/:id', authenticate, authorize('management'), async (req, res) => {
  try {
    // Soft delete - set is_active to false
    const [result] = await pool.query(
      'UPDATE users SET is_active = false WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
});

// Get team members (for team leads)
router.get('/team/members', authenticate, async (req, res) => {
  try {
    const teamId = req.user.team_id;

    const [rows] = await pool.query(
      `SELECT id, name, email, role, designation, avatar_url
       FROM users
       WHERE team_id = ? AND is_active = true
       ORDER BY name`,
      [teamId]
    );

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching team members'
    });
  }
});

module.exports = router;
