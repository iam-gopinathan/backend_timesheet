const bcrypt = require('bcryptjs');
const pool = require('./src/config/database');

async function fixAdmin() {
  try {
    // Hash the password "admin123"
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Check if admin exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = 'admin@company.com'"
    );

    if (existing.rows.length > 0) {
      // Update existing admin password
      await pool.query(
        "UPDATE users SET password = $1 WHERE email = 'admin@company.com'",
        [hashedPassword]
      );
      console.log('Admin password updated!');
    } else {
      // Create admin user
      await pool.query(
        `INSERT INTO users (name, email, password, role, designation, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['Admin User', 'admin@company.com', hashedPassword, 'management', 'System Administrator', true]
      );
      console.log('Admin user created!');
    }

    console.log('Email: admin@company.com');
    console.log('Password: admin123');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAdmin();
