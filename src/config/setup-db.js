const mysql = require('mysql2/promise');
require('dotenv').config();

const schema = `
-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('employee', 'team_lead', 'management') DEFAULT 'employee',
    designation VARCHAR(100),
    team_id INT,
    avatar_url VARCHAR(500),
    phone VARCHAR(20),
    joined_date DATE DEFAULT (CURRENT_DATE),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    project_code VARCHAR(10) UNIQUE NOT NULL,
    color VARCHAR(7) DEFAULT '#0052CC',
    icon VARCHAR(50) DEFAULT 'folder',
    next_issue_number INT DEFAULT 1,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Workspace members (many-to-many)
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INT,
    user_id INT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status ENUM('todo', 'in_progress', 'review', 'done') DEFAULT 'todo',
    priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    workspace_id INT,
    project_code VARCHAR(10),
    issue_number INT,
    assignee_id INT,
    assigned_by_id INT,
    estimated_hours INT DEFAULT 0,
    logged_hours INT DEFAULT 0,
    deadline DATE,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_by_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Task labels
CREATE TABLE IF NOT EXISTS labels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#0052CC',
    workspace_id INT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Task-Label relationship (many-to-many)
CREATE TABLE IF NOT EXISTS task_labels (
    task_id INT,
    label_id INT,
    PRIMARY KEY (task_id, label_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT,
    user_id INT,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Time logs
CREATE TABLE IF NOT EXISTS time_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT,
    user_id INT,
    hours DECIMAL(5,2) NOT NULL,
    description TEXT,
    log_date DATE DEFAULT (CURRENT_DATE),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
`;

const seedData = `
-- Insert default teams
INSERT IGNORE INTO teams (id, name, description) VALUES
    (1, 'Development', 'Software Development Team'),
    (2, 'QA', 'Quality Assurance Team'),
    (3, 'Design', 'UI/UX Design Team');

-- Insert default admin user (password: admin123)
INSERT IGNORE INTO users (id, name, email, password, role, designation) VALUES
    (1, 'Admin User', 'admin@company.com', '$2a$10$rKN3uZx.9HVMPkVx1xOvZeY8Qj8nX5QFq5HvLJY5ZzKvJ5.X5Qz5W', 'management', 'System Administrator');
`;

async function setupDatabase() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      multipleStatements: true
    });

    console.log('Connected to MySQL database...');

    // Run schema
    console.log('Creating tables...');
    await connection.query(schema);
    console.log('Tables created successfully!');

    // Run seed data
    console.log('Inserting default data...');
    await connection.query(seedData);
    console.log('Default data inserted!');

    console.log('\n✅ Database setup completed successfully!');
    console.log('\nDefault admin login:');
    console.log('  Email: admin@company.com');
    console.log('  Password: admin123');

  } catch (error) {
    console.error('Error setting up database:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit();
  }
}

setupDatabase();
