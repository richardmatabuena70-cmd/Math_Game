-- Math Quiz Game - Supabase (PostgreSQL) Database Setup
-- Run this script in Supabase SQL Editor or via psql
--
-- Supabase Connection:
-- Host: db.YOUR_PROJECT_REF.supabase.co
-- Port: 5432
-- Database: postgres
-- User: postgres
-- Password: YOUR_DATABASE_PASSWORD

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    theme VARCHAR(50) DEFAULT 'light',
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create user_stats table for tracking statistics
CREATE TABLE IF NOT EXISTS user_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    total_games INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    highest_score INTEGER DEFAULT 0,
    total_questions_answered INTEGER DEFAULT 0,
    total_correct_answers INTEGER DEFAULT 0,
    average_score DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create achievements table
CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    points INTEGER DEFAULT 0,
    requirement_type VARCHAR(100),
    requirement_value INTEGER DEFAULT 0,
    icon VARCHAR(100)
);

-- Create user_achievements table
CREATE TABLE IF NOT EXISTS user_achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- Create quiz_sessions table
CREATE TABLE IF NOT EXISTS quiz_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    difficulty VARCHAR(50) NOT NULL,
    category VARCHAR(100) DEFAULT 'mixed',
    score INTEGER DEFAULT 0,
    time_left INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 10,
    correct_answers INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create quiz_questions table
CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    question TEXT NOT NULL,
    correct_answer VARCHAR(255) NOT NULL,
    user_answer VARCHAR(255),
    is_correct BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON users(is_deleted);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_session ON quiz_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_user ON user_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

-- Insert default achievements
INSERT INTO achievements (name, description, points, requirement_type, requirement_value, icon) VALUES
    ('First Steps', 'Complete your first quiz', 10, 'games', 1, 'trophy'),
    ('Getting Good', 'Score 50 points in a single quiz', 20, 'score', 50, 'star'),
    ('Quiz Master', 'Complete 10 quizzes', 50, 'games', 10, 'medal'),
    ('High Scorer', 'Get a score of 100', 100, 'score', 100, 'crown'),
    ('Perfect Score', 'Answer all questions correctly', 150, 'perfect', 1, 'star'),
    ('Speed Demon', 'Complete a quiz with time left', 30, 'time', 30, 'flash'),
    ('Dedicated Player', 'Play 50 quizzes', 200, 'games', 50, 'fire')
ON CONFLICT DO NOTHING;

-- Enable Row Level Security (RLS) - Optional, for additional security
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to access their own data
-- CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
-- CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);

-- Note: For Supabase Auth integration, you would typically:
-- 1. Use Supabase Auth instead of custom JWT
-- 2. Set up RLS policies based on auth.uid()
-- 3. Use Supabase's built-in authentication

-- Verify tables created
SELECT 'Users table:' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';

SELECT 'User Stats table:' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_stats';

SELECT 'Achievements table:' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'achievements';

SELECT 'Quiz Sessions table:' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quiz_sessions';

SELECT 'Quiz Questions table:' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quiz_questions';

SELECT 'Database setup complete!' AS status;
