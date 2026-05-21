-- Timesheet Database Schema

-- Create enum types
CREATE TYPE user_role AS ENUM ('employee', 'team_lead', 'management');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'highest');

-- Teams table
CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'employee',
    designation VARCHAR(100),
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    avatar_url VARCHAR(500),
    phone VARCHAR(20),
    joined_date DATE DEFAULT CURRENT_DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workspaces table
CREATE TABLE workspaces (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    project_code VARCHAR(10) UNIQUE NOT NULL,
    color VARCHAR(7) DEFAULT '#0052CC',
    icon VARCHAR(50) DEFAULT 'folder',
    next_issue_number INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workspace members (many-to-many)
CREATE TABLE workspace_members (
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
);

-- Tasks table
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status task_status DEFAULT 'todo',
    priority task_priority DEFAULT 'medium',
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    project_code VARCHAR(10),
    issue_number INTEGER,
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    estimated_hours INTEGER DEFAULT 0,
    logged_hours INTEGER DEFAULT 0,
    deadline DATE,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task labels
CREATE TABLE labels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#0052CC',
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Task-Label relationship (many-to-many)
CREATE TABLE task_labels (
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

-- Task comments
CREATE TABLE task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time logs
CREATE TABLE time_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    hours DECIMAL(5,2) NOT NULL,
    description TEXT,
    log_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_users_email ON users(email);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default teams
INSERT INTO teams (name, description) VALUES
    ('Development', 'Software Development Team'),
    ('QA', 'Quality Assurance Team'),
    ('Design', 'UI/UX Design Team');

-- Insert default admin user (password: admin123)
INSERT INTO users (name, email, password, role, designation) VALUES
    ('Admin User', 'admin@company.com', '$2a$10$rKN3uZx.9HVMPkVx1xOvZeY8Qj8nX5QFq5HvLJY5ZzKvJ5.X5Qz5W', 'management', 'System Administrator');
