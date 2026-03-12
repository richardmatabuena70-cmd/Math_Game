const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'math-quiz-game-secret-key-2024';

// Rate limiting
const rateLimit = require('express-rate-limit');

// MySQL Connection Configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'math_quiz_game',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25, // 25 requests per window
  message: { error: 'Too many requests, please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: { error: 'Too many login attempts, please try again in 15 minutes.' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// JWT Token verification middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Database initialization
async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    // Check if users table exists and has is_deleted column
    let tableExists = false;
    let hasIsDeleted = false;
    
    try {
      const [tables] = await connection.execute("SHOW TABLES LIKE 'users'");
      tableExists = tables.length > 0;
      
      if (tableExists) {
        const [columns] = await connection.execute("SHOW COLUMNS FROM users LIKE 'is_deleted'");
        hasIsDeleted = columns.length > 0;
      }
    } catch (e) {
      tableExists = false;
    }

    // Create users table if not exists
    if (!tableExists) {
      await connection.execute(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          theme VARCHAR(50) DEFAULT 'dark',
          is_deleted TINYINT(1) DEFAULT 0,
          deleted_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else if (!hasIsDeleted) {
      // Add missing columns to existing table
      await connection.execute(`ALTER TABLE users 
        ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 AFTER theme,
        ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER is_deleted`);
    }

    // Create user_stats table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        total_games INT DEFAULT 0,
        total_correct INT DEFAULT 0,
        total_questions INT DEFAULT 0,
        highest_score INT DEFAULT 0,
        current_streak INT DEFAULT 0,
        longest_streak INT DEFAULT 0,
        last_played_date DATE DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create achievements table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS achievements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) NOT NULL,
        icon VARCHAR(50) NOT NULL,
        requirement_type VARCHAR(50) NOT NULL,
        requirement_value INT NOT NULL,
        points INT DEFAULT 10
      )
    `);

    // Insert default achievements if not exists
    const [existingAchievements] = await connection.execute('SELECT COUNT(*) as count FROM achievements');
    if (existingAchievements[0].count === 0) {
      await connection.execute(`
        INSERT INTO achievements (name, description, icon, requirement_type, requirement_value, points) VALUES
        ('First Steps', 'Complete your first quiz', '🎯', 'games', 1, 10),
        ('Getting Started', 'Complete 10 quizzes', '🌟', 'games', 10, 25),
        ('Quiz Master', 'Complete 50 quizzes', '🏆', 'games', 50, 50),
        ('Math Wizard', 'Complete 100 quizzes', '🧙', 'games', 100, 100),
        ('Perfect Score', 'Get 100% on a quiz', '💯', 'perfect', 1, 30),
        ('Streak Starter', 'Achieve a 3-day streak', '🔥', 'streak', 3, 20),
        ('On Fire', 'Achieve a 7-day streak', '💥', 'streak', 7, 40),
        ('Unstoppable', 'Achieve a 30-day streak', '🚀', 'streak', 30, 100),
        ('Speed Demon', 'Answer 50 questions correctly', '⚡', 'correct', 50, 25),
        ('Math Genius', 'Answer 200 questions correctly', '🧠', 'correct', 200, 75),
        ('High Scorer', 'Score over 80 points in one game', '🎖️', 'score', 80, 20),
        ('Addition Expert', 'Answer 50 addition questions correctly', '➕', 'addition', 50, 30),
        ('Subtraction Expert', 'Answer 50 subtraction questions correctly', '➖', 'subtraction', 50, 30),
        ('Multiplication Expert', 'Answer 50 multiplication questions correctly', '✖️', 'multiplication', 50, 30),
        ('Division Expert', 'Answer 50 division questions correctly', '➗', 'division', 50, 30)
      `);
    }

    // Create user_achievements table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        achievement_id INT NOT NULL,
        earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_achievement (user_id, achievement_id)
      )
    `);

    // Create quiz_sessions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        difficulty VARCHAR(50) NOT NULL,
        category VARCHAR(50) DEFAULT 'mixed',
        score INT NOT NULL,
        time_left INT NOT NULL,
        total_questions INT DEFAULT 10,
        correct_answers INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // Add missing columns if they don't exist (for existing databases)
    try {
      // Check if correct_answers column exists
      const [cols] = await connection.execute("SHOW COLUMNS FROM quiz_sessions LIKE 'correct_answers'");
      if (cols.length === 0) {
        await connection.execute(`ALTER TABLE quiz_sessions ADD COLUMN correct_answers INT DEFAULT 0`);
      }
    } catch (e) {
      console.log('correct_answers column check:', e.message);
    }
    try {
      // Check if category column exists
      const [cols] = await connection.execute("SHOW COLUMNS FROM quiz_sessions LIKE 'category'");
      if (cols.length === 0) {
        await connection.execute(`ALTER TABLE quiz_sessions ADD COLUMN category VARCHAR(50) DEFAULT 'mixed'`);
      }
    } catch (e) {
      console.log('category column check:', e.message);
    }

    // Create quiz_questions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        question_number INT NOT NULL,
        question TEXT NOT NULL,
        correct_answer INT NOT NULL,
        user_answer INT,
        is_correct INT,
        FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    try {
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(is_deleted)`);
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id)`);
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_quiz_questions_session ON quiz_questions(session_id)`);
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_user_stats_user ON user_stats(user_id)`);
      await connection.execute(`CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id)`);
    } catch (e) {
      // Indexes might already exist
    }

    console.log('Database connected and tables initialized');
  } finally {
    connection.release();
  }
}

// Input validation helpers
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateName(name) {
  return name && name.trim().length >= 2 && name.trim().length <= 50 && /^[a-zA-Z\s]+$/.test(name.trim());
}

function validatePassword(password) {
  return password && password.length >= 4 && password.length <= 50;
}

function validateDifficulty(difficulty) {
  return ['easy', 'medium', 'hard'].includes(difficulty);
}

// ============ AUTH ROUTES ============

// Register with rate limiting
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Server-side validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!validateName(name)) {
      return res.status(400).json({ error: 'Name must be 2-50 characters and contain only letters' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be 4-50 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_deleted = 0', [normalizedEmail]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if deleted user with same email exists
    const [deletedUsers] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_deleted = 1', [normalizedEmail]);
    
    if (deletedUsers.length > 0) {
      // Restore deleted user
      const hashedPassword = bcrypt.hashSync(password, 10);
      await pool.execute('UPDATE users SET password = ?, name = ?, is_deleted = 0, deleted_at = NULL WHERE id = ?', 
        [hashedPassword, name.trim(), deletedUsers[0].id]);
      
      const token = jwt.sign({ id: deletedUsers[0].id, email: normalizedEmail }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ 
        success: true, 
        token, 
        user: { id: deletedUsers[0].id, name: name.trim(), email: normalizedEmail, theme: 'dark' }
      });
    }

    // Create new user
    const hashedPassword = bcrypt.hashSync(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name.trim(), normalizedEmail, hashedPassword]
    );

    const token = jwt.sign({ id: result.insertId, email: normalizedEmail }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ 
      success: true, 
      token, 
      user: { id: result.insertId, name: name.trim(), email: normalizedEmail, theme: 'dark' }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login with rate limiting
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const [users] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_deleted = 0', [normalizedEmail]);
    const user = users[0];

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ 
      success: true, 
      token, 
      user: { id: user.id, name: user.name, email: user.email, theme: user.theme }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Restore deleted user and login (no rate limiting for restore)
app.post('/api/auth/restore', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists and is deleted
    const [users] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_deleted = 1', [normalizedEmail]);
    const user = users[0];

    if (!user) {
      return res.status(404).json({ error: 'No deleted account found with this email' });
    }

    // Verify password
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Restore the account
    await pool.execute('UPDATE users SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [user.id]);

    // Generate token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ 
      success: true, 
      token, 
      user: { id: user.id, name: user.name, email: user.email, theme: user.theme, is_deleted: 0 }
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore account' });
  }
});

// Get all users (for admin display)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, name, email, theme, is_deleted, deleted_at, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID (must be after /api/users to avoid conflict)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (isNaN(userId) || userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [users] = await pool.execute('SELECT id, name, email, theme, is_deleted, deleted_at, created_at FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Restore deleted user
app.post('/api/users/restore', authenticateToken, async (req, res) => {
  try {
    await pool.execute('UPDATE users SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account restored' });
  } catch (error) {
    console.error('Restore user error:', error);
    res.status(500).json({ error: 'Failed to restore account' });
  }
});

// Soft delete user (set is_deleted = 1)
app.delete('/api/users', authenticateToken, async (req, res) => {
  try {
    await pool.execute('UPDATE users SET is_deleted = 1, deleted_at = NOW() WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Permanent delete user
app.delete('/api/users/permanent', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Verify password before deletion
    const [users] = await pool.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const user = users[0];
    
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Permanently delete user (cascade will delete quiz sessions and questions)
    await pool.execute('DELETE FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (error) {
    console.error('Permanent delete user error:', error);
    res.status(500).json({ error: 'Failed to permanently delete account' });
  }
});

// Update theme
app.put('/api/auth/theme', authenticateToken, async (req, res) => {
  try {
    const { theme } = req.body;
    
    if (!['dark', 'light'].includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme' });
    }
    
    await pool.execute('UPDATE users SET theme = ? WHERE id = ?', [theme, req.user.id]);
    res.json({ success: true, theme });
  } catch (error) {
    console.error('Update theme error:', error);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

// ============ QUIZ ROUTES ============

// Start quiz session
app.post('/api/quiz/start', authenticateToken, async (req, res) => {
  try {
    const { difficulty, timeLeft } = req.body;
    
    // Validate difficulty
    if (!validateDifficulty(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty level' });
    }
    
    // Validate timeLeft
    if (typeof timeLeft !== 'number' || timeLeft < 0) {
      return res.status(400).json({ error: 'Invalid time left' });
    }
    
    const userId = req.user.id;
    
    // Create quiz session with time_left
    const [result] = await pool.execute(
      'INSERT INTO quiz_sessions (user_id, difficulty, score, time_left, total_questions) VALUES (?, ?, ?, ?, ?)',
      [userId, difficulty, 0, timeLeft, 10]
    );
    
    const sessionId = result.insertId;
    console.log('Quiz session started with ID:', sessionId, 'time_left:', timeLeft);
    
    res.json({ success: true, sessionId, time_left: timeLeft });
  } catch (error) {
    console.error('Start quiz error:', error);
    res.status(500).json({ error: 'Failed to start quiz' });
  }
});

// Add question to session
app.post('/api/quiz/question', authenticateToken, async (req, res) => {
  try {
    const { sessionId, questionNumber, question, correctAnswer } = req.body;
    
    // Verify session belongs to user
    const [sessions] = await pool.execute(
      'SELECT id FROM quiz_sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.user.id]
    );
    
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    await pool.execute(
      'INSERT INTO quiz_questions (session_id, question_number, question, correct_answer) VALUES (?, ?, ?, ?)',
      [sessionId, questionNumber, question, correctAnswer]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// Submit answer
app.put('/api/quiz/answer', authenticateToken, async (req, res) => {
  try {
    const { sessionId, questionNumber, userAnswer } = req.body;
    
    // Get the question to check if correct
    const [questions] = await pool.execute(
      'SELECT id, correct_answer FROM quiz_questions WHERE session_id = ? AND question_number = ?',
      [sessionId, questionNumber]
    );
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    const isCorrect = userAnswer === questions[0].correct_answer ? 1 : 0;
    
    await pool.execute(
      'UPDATE quiz_questions SET user_answer = ?, is_correct = ? WHERE id = ?',
      [userAnswer, isCorrect, questions[0].id]
    );
    
    res.json({ success: true, is_correct: isCorrect });
  } catch (error) {
    console.error('Submit answer error:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// Finish quiz
app.post('/api/quiz/finish', authenticateToken, async (req, res) => {
  try {
    const { sessionId, score, timeLeft } = req.body;
    
    // Verify session belongs to user
    const [sessions] = await pool.execute(
      'SELECT id, time_left FROM quiz_sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.user.id]
    );
    
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Update the session with score and remaining time
    // timeLeft is optional - if not provided, keep the original time_left
    const finalTimeLeft = typeof timeLeft === 'number' ? timeLeft : sessions[0].time_left;
    
    await pool.execute(
      'UPDATE quiz_sessions SET score = ?, time_left = ? WHERE id = ?',
      [score, finalTimeLeft, sessionId]
    );
    
    console.log('Quiz finished - Session:', sessionId, 'Score:', score, 'Time left:', finalTimeLeft);
    
    res.json({ success: true, sessionId, score, time_left: finalTimeLeft });
  } catch (error) {
    console.error('Finish quiz error:', error);
    res.status(500).json({ error: 'Failed to finish quiz' });
  }
});

// Get quiz history
app.get('/api/quiz/history', authenticateToken, async (req, res) => {
  try {
    const [sessions] = await pool.execute(
      `SELECT qs.*, 
        (SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'question_number', qq.question_number,
            'question', qq.question,
            'correct_answer', qq.correct_answer,
            'user_answer', qq.user_answer,
            'is_correct', qq.is_correct
          )
        ) FROM quiz_questions qq WHERE qq.session_id = qs.id) as questions
       FROM quiz_sessions qs 
       WHERE qs.user_id = ? 
       ORDER BY qs.created_at DESC`,
      [req.user.id]
    );
    
    res.json(sessions);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Get all quiz sessions (for viewing other users' quizzes)
app.get('/api/quiz/all-sessions', authenticateToken, async (req, res) => {
  try {
    const [sessions] = await pool.execute(
      `SELECT qs.id, qs.user_id, qs.difficulty, qs.category, qs.score, qs.time_left, 
              qs.total_questions, qs.correct_answers, qs.created_at,
              u.name as user_name,
        (SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'question_number', qq.question_number,
            'question', qq.question,
            'correct_answer', qq.correct_answer,
            'user_answer', qq.user_answer,
            'is_correct', qq.is_correct
          )
        ) FROM quiz_questions qq WHERE qq.session_id = qs.id) as questions
       FROM quiz_sessions qs 
       JOIN users u ON qs.user_id = u.id
       WHERE u.is_deleted = 0
       ORDER BY qs.created_at DESC`
    );
    
    res.json(sessions);
  } catch (error) {
    console.error('Get all sessions error:', error);
    res.status(500).json({ error: 'Failed to get all sessions' });
  }
});

// Delete a session
app.delete('/api/quiz/session/:id', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.params.id;
    
    await pool.execute('DELETE FROM quiz_sessions WHERE id = ? AND user_id = ?', 
      [sessionId, req.user.id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Generate quiz questions
app.post('/api/quiz/generate', authenticateToken, async (req, res) => {
  try {
    const { difficulty, count = 10, category = 'mixed' } = req.body;
    
    // Validate difficulty
    if (!validateDifficulty(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty level' });
    }
    
    // Validate category
    const validCategories = ['addition', 'subtraction', 'multiplication', 'division', 'mixed'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    
    // Validate count
    const questionCount = Math.min(Math.max(parseInt(count) || 10, 1), 50);
    
    const questions = [];
    
    // Get max number based on difficulty
    let maxNum = 50;
    if (difficulty === 'easy') maxNum = 20;
    else if (difficulty === 'medium') maxNum = 50;
    else maxNum = 100;
    
    // Determine operations based on category
    const operations = category === 'mixed' 
      ? ['+', '-', '×', '÷']
      : [category === 'addition' ? '+' : category === 'subtraction' ? '-' : category === 'multiplication' ? '×' : '÷'];
    
    for (let i = 0; i < questionCount; i++) {
      let operator, num1, num2, correctAnswer;
      
      // Select random operation from available ones
      const selectedOp = operations[Math.floor(Math.random() * operations.length)];
      
      switch (selectedOp) {
        case '+': // Addition
          operator = '+';
          num1 = Math.floor(Math.random() * maxNum) + 1;
          num2 = Math.floor(Math.random() * maxNum) + 1;
          correctAnswer = num1 + num2;
          break;
        case '-': // Subtraction
          operator = '−';
          num1 = Math.floor(Math.random() * maxNum) + 1;
          num2 = Math.floor(Math.random() * num1) + 1;
          correctAnswer = num1 - num2;
          break;
        case '×': // Multiplication
          operator = '×';
          const multMax = difficulty === 'easy' ? 10 : difficulty === 'medium' ? 12 : 15;
          num1 = Math.floor(Math.random() * multMax) + 1;
          num2 = Math.floor(Math.random() * multMax) + 1;
          correctAnswer = num1 * num2;
          break;
        case '÷': // Division
          operator = '÷';
          const divMax = difficulty === 'easy' ? 10 : difficulty === 'medium' ? 12 : 15;
          num2 = Math.floor(Math.random() * divMax) + 1;
          correctAnswer = Math.floor(Math.random() * divMax) + 1;
          num1 = num2 * correctAnswer;
          break;
        default:
          operator = '+';
          num1 = Math.floor(Math.random() * 20) + 1;
          num2 = Math.floor(Math.random() * 20) + 1;
          correctAnswer = num1 + num2;
      }
      
      questions.push({
        num1,
        num2,
        operator,
        correctAnswer,
        question: `${num1} ${operator} ${num2} = ?`
      });
    }
    
    res.json({ success: true, questions, category, difficulty });
  } catch (error) {
    console.error('Generate quiz error:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// Save quiz score (legacy endpoint)
app.post('/api/scores', authenticateToken, async (req, res) => {
  try {
    const { score, correctAnswers, totalQuestions, difficulty, questions, timeLeft, category } = req.body;
    
    console.log('Saving score - questions received:', questions ? questions.length : 'undefined');
    console.log('Time left received:', timeLeft);
    
    // Validate input
    if (typeof score !== 'number' || score < 0) {
      return res.status(400).json({ error: 'Invalid score' });
    }
    
    if (!validateDifficulty(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }
    
    const userId = req.user.id;
    
    // Create quiz session with time_left and correct_answers from request
    const finalTimeLeft = typeof timeLeft === 'number' ? timeLeft : 0;
    const finalCorrectAnswers = typeof correctAnswers === 'number' ? correctAnswers : 0;
    
    console.log('Saving quiz session:', {
      userId,
      difficulty,
      score,
      timeLeft: finalTimeLeft,
      totalQuestions,
      correctAnswers: finalCorrectAnswers
    });
    
    const [result] = await pool.execute(
      'INSERT INTO quiz_sessions (user_id, difficulty, category, score, time_left, total_questions, correct_answers) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, difficulty, category || 'mixed', score, finalTimeLeft, totalQuestions || 10, finalCorrectAnswers]
    );
    
    const sessionId = result.insertId;
    console.log('Session created with ID:', sessionId);
    
    // Save questions if provided
    if (questions && Array.isArray(questions) && questions.length > 0) {
      console.log('Saving', questions.length, 'questions...');
      for (const q of questions) {
        try {
          const [insertResult] = await pool.execute(
            `INSERT INTO quiz_questions (session_id, question_number, question, correct_answer, user_answer, is_correct) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, q.questionNumber, q.question, q.correctAnswer, q.userAnswer, q.isCorrect ? 1 : 0]
          );
          console.log('Saved question:', q.questionNumber);
        } catch (e) {
          console.error('Error saving question:', e);
        }
      }
    } else {
      console.log('No questions to save - questions array is:', questions);
    }
    
    res.json({ success: true, sessionId });
  } catch (error) {
    console.error('Save score error:', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// Get all scores for user
app.get('/api/scores', authenticateToken, async (req, res) => {
  try {
    const [scores] = await pool.execute(
      'SELECT * FROM quiz_sessions WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(scores);
  } catch (error) {
    console.error('Get scores error:', error);
    res.status(500).json({ error: 'Failed to get scores' });
  }
});

// Get all scores from all users (for viewing other users' quizzes)
app.get('/api/scores/all', authenticateToken, async (req, res) => {
  try {
    const [scores] = await pool.execute(
      `SELECT qs.*, u.name as user_name 
       FROM quiz_sessions qs 
       JOIN users u ON qs.user_id = u.id 
       WHERE u.is_deleted = 0 
       ORDER BY qs.created_at DESC`
    );
    res.json(scores);
  } catch (error) {
    console.error('Get all scores error:', error);
    res.status(500).json({ error: 'Failed to get all scores' });
  }
});

// Get questions for a specific session
app.get('/api/quiz/session/:id/questions', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.params.id;
    
    // Get session info
    const [sessions] = await pool.execute(
      `SELECT qs.*, u.name as user_name 
       FROM quiz_sessions qs 
       JOIN users u ON qs.user_id = u.id 
       WHERE qs.id = ?`,
      [sessionId]
    );
    
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get questions
    const [questions] = await pool.execute(
      'SELECT * FROM quiz_questions WHERE session_id = ? ORDER BY question_number',
      [sessionId]
    );
    
    res.json({
      session: sessions[0],
      questions: questions
    });
  } catch (error) {
    console.error('Get session questions error:', error);
    res.status(500).json({ error: 'Failed to get session questions' });
  }
});

// Delete all scores for user
app.delete('/api/scores', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Delete quiz sessions (this will cascade to quiz_questions)
    await pool.execute('DELETE FROM quiz_sessions WHERE user_id = ?', [userId]);
    
    // Delete user achievements
    await pool.execute('DELETE FROM user_achievements WHERE user_id = ?', [userId]);
    
    // Delete or reset user stats
    const [existingStats] = await pool.execute('SELECT id FROM user_stats WHERE user_id = ?', [userId]);
    if (existingStats.length > 0) {
      // Reset existing stats
      await pool.execute(`
        UPDATE user_stats SET 
          total_games = 0,
          total_correct = 0,
          total_questions = 0,
          highest_score = 0,
          current_streak = 0,
          longest_streak = 0,
          last_played_date = NULL
        WHERE user_id = ?
      `, [userId]);
    } else {
      // Create new empty stats row
      await pool.execute('INSERT INTO user_stats (user_id) VALUES (?)', [userId]);
    }
    
    res.json({ success: true, message: 'All records, achievements and stats deleted' });
  } catch (error) {
    console.error('Delete scores error:', error);
    res.status(500).json({ error: 'Failed to delete scores' });
  }
});

// Delete latest score and update achievements/stats
app.delete('/api/scores/latest', authenticateToken, async (req, res) => {
  try {
    // First, get the latest session data before deleting
    const [sessions] = await pool.execute(
      'SELECT * FROM quiz_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );
    
    if (sessions.length === 0) {
      return res.status(404).json({ error: 'No score to delete' });
    }
    
    const deletedSession = sessions[0];
    
    // Delete the quiz session (this will also delete related questions due to foreign key)
    await pool.execute('DELETE FROM quiz_sessions WHERE id = ?', [deletedSession.id]);
    
    // Recalculate stats from remaining sessions
    const [remainingSessions] = await pool.execute(
      'SELECT SUM(score) as total_score, COUNT(*) as games_count FROM quiz_sessions WHERE user_id = ?',
      [req.user.id]
    );
    
    // Get total correct and questions from remaining sessions
    const [questionStats] = await pool.execute(`
      SELECT 
        SUM(CASE WHEN q.user_answer = q.correct_answer THEN 1 ELSE 0 END) as total_correct,
        COUNT(q.id) as total_questions
      FROM quiz_questions q
      JOIN quiz_sessions qs ON q.session_id = qs.id
      WHERE qs.user_id = ?
    `, [req.user.id]);
    
    const totalGames = remainingSessions[0].games_count || 0;
    const totalCorrect = questionStats[0].total_correct || 0;
    const totalQuestions = questionStats[0].total_questions || 0;
    
    // Update user stats (no total_score or accuracy columns exist)
    const accuracy = totalQuestions > 0 ? Math.round(totalCorrect / totalQuestions * 100) : 0;
    
    if (totalGames > 0) {
      // Get highest score from remaining sessions
      const [highestScoreResult] = await pool.execute(
        'SELECT MAX(score) as highest FROM quiz_sessions WHERE user_id = ?',
        [req.user.id]
      );
      const highestScore = highestScoreResult[0].highest || 0;
      
      await pool.execute(`
        UPDATE user_stats SET
          total_games = ?,
          total_correct = ?,
          total_questions = ?,
          highest_score = ?
        WHERE user_id = ?
      `, [totalGames, totalCorrect, totalQuestions, highestScore, req.user.id]);
    } else {
      // Reset stats if no games left
      await pool.execute(`
        UPDATE user_stats SET
          total_games = 0,
          total_correct = 0,
          total_questions = 0,
          highest_score = 0,
          current_streak = 0,
          longest_streak = 0,
          last_played_date = NULL
        WHERE user_id = ?
      `, [req.user.id]);
      
      // Also delete all achievements if no games left
      await pool.execute('DELETE FROM user_achievements WHERE user_id = ?', [req.user.id]);
    }
    
    // If this was the last quiz (totalGames is now 0 after deletion), reset streaks
    if (totalGames === 0) {
      await pool.execute(`
        UPDATE user_stats SET
          current_streak = 0,
          longest_streak = 0,
          last_played_date = NULL
        WHERE user_id = ?
      `, [req.user.id]);
    }
    
    // Return success with remaining sessions count
    res.json({ 
      success: true, 
      message: 'Latest score deleted and stats updated',
      remainingSessions: totalGames
    });
  } catch (error) {
    console.error('Delete latest score error:', error);
    res.status(500).json({ error: 'Failed to delete latest score' });
  }
});

// Get leaderboard
app.get('/api/scores/ranking', authenticateToken, async (req, res) => {
  try {
    const [rankings] = await pool.execute(`
      SELECT u.id as user_id, u.name as username, 
             COALESCE(SUM(qs.score), 0) as totalScore,
             COUNT(qs.id) as gamesPlayed
      FROM users u
      LEFT JOIN quiz_sessions qs ON u.id = qs.user_id
      WHERE u.is_deleted = 0
      GROUP BY u.id
      ORDER BY totalScore DESC
      LIMIT 10
    `);
    res.json(rankings);
  } catch (error) {
    console.error('Get ranking error:', error);
    res.status(500).json({ error: 'Failed to get rankings' });
  }
});

// ============ ACHIEVEMENTS & STATS ROUTES ============

// Initialize user stats when user registers
async function initUserStats(userId) {
  try {
    await pool.execute(
      'INSERT INTO user_stats (user_id) VALUES (?)',
      [userId]
    );
  } catch (error) {
    console.error('Init user stats error:', error);
  }
}

// Get user stats
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get or create user stats
    let [stats] = await pool.execute(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [userId]
    );
    
    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.execute(
        'SELECT * FROM user_stats WHERE user_id = ?',
        [userId]
      );
    }
    
    // Calculate accuracy
    const stat = stats[0];
    const accuracy = stat.total_questions > 0 
      ? Math.round((stat.total_correct / stat.total_questions) * 100) 
      : 0;
    
    res.json({
      ...stat,
      accuracy
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get user achievements
app.get('/api/achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all achievements
    const [allAchievements] = await pool.execute(
      'SELECT * FROM achievements ORDER BY points'
    );
    
    // Get user's earned achievements
    const [userAchievements] = await pool.execute(
      'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
      [userId]
    );
    
    const earnedIds = userAchievements.map(ua => ua.achievement_id);
    
    // Mark achievements as earned or not
    const achievements = allAchievements.map(a => ({
      ...a,
      earned: earnedIds.includes(a.id),
      earnedAt: null
    }));
    
    // Get earned dates
    for (let i = 0; i < achievements.length; i++) {
      if (achievements[i].earned) {
        const [earned] = await pool.execute(
          'SELECT earned_at FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
          [userId, achievements[i].id]
        );
        if (earned.length > 0) {
          achievements[i].earnedAt = earned[0].earned_at;
        }
      }
    }
    
    res.json(achievements);
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ error: 'Failed to get achievements' });
  }
});

// Check and award achievements after quiz
async function checkAchievements(userId, quizScore, correctAnswers, totalQuestions, streak) {
  try {
    const earnedAchievements = [];
    
    // Get current stats
    let [stats] = await pool.execute(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [userId]
    );
    
    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.execute(
        'SELECT * FROM user_stats WHERE user_id = ?',
        [userId]
      );
    }
    
    const stat = stats[0];
    
    // Check achievement conditions
    const checks = [
      // Games played achievements
      { type: 'games', value: stat.total_games + 1 },
      // Perfect score
      { type: 'perfect', value: correctAnswers === totalQuestions ? 1 : 0 },
      // Streak achievements
      { type: 'streak', value: streak },
      // Total correct answers
      { type: 'correct', value: stat.total_correct + correctAnswers },
      // High score
      { type: 'score', value: quizScore }
    ];
    
    for (const check of checks) {
      // Get achievements for this type
      const [achievements] = await pool.execute(
        'SELECT * FROM achievements WHERE requirement_type = ? AND requirement_value <= ?',
        [check.type, check.value]
      );
      
      for (const achievement of achievements) {
        // Check if already earned
        const [existing] = await pool.execute(
          'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
          [userId, achievement.id]
        );
        
        if (existing.length === 0) {
          // Award achievement
          await pool.execute(
            'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
            [userId, achievement.id]
          );
          earnedAchievements.push(achievement);
        }
      }
    }
    
    return earnedAchievements;
  } catch (error) {
    console.error('Check achievements error:', error);
    return [];
  }
}

// Update user stats after quiz
app.post('/api/stats/update', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { score, correctAnswers, totalQuestions, difficulty, category } = req.body;
    
    // Get or create user stats
    let [stats] = await pool.execute(
      'SELECT * FROM user_stats WHERE user_id = ?',
      [userId]
    );
    
    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.execute(
        'SELECT * FROM user_stats WHERE user_id = ?',
        [userId]
      );
    }
    
    const stat = stats[0];
    const today = new Date().toISOString().split('T')[0];
    const lastPlayed = stat.last_played_date ? stat.last_played_date.toISOString().split('T')[0] : null;
    
    // Calculate streak
    let newStreak = stat.current_streak;
    if (lastPlayed === today) {
      // Already played today, keep streak
      newStreak = stat.current_streak;
    } else if (lastPlayed) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (lastPlayed === yesterdayStr) {
        // Played yesterday, increment streak
        newStreak = stat.current_streak + 1;
      } else {
        // Streak broken
        newStreak = 1;
      }
    } else {
      // First game ever
      newStreak = 1;
    }
    
    const longestStreak = Math.max(stat.longest_streak, newStreak);
    const highestScore = Math.max(stat.highest_score, score);
    
    // Update stats
    await pool.execute(`
      UPDATE user_stats SET 
        total_games = total_games + 1,
        total_correct = total_correct + ?,
        total_questions = total_questions + ?,
        highest_score = ?,
        current_streak = ?,
        longest_streak = ?,
        last_played_date = ?
      WHERE user_id = ?
    `, [correctAnswers, totalQuestions, highestScore, newStreak, longestStreak, today, userId]);
    
    // Check for new achievements
    const newAchievements = await checkAchievements(userId, score, correctAnswers, totalQuestions, newStreak);
    
    res.json({
      success: true,
      stats: {
        totalGames: stat.total_games + 1,
        totalCorrect: stat.total_correct + correctAnswers,
        totalQuestions: stat.total_questions + totalQuestions,
        highestScore,
        currentStreak: newStreak,
        longestStreak
      },
      newAchievements
    });
  } catch (error) {
    console.error('Update stats error:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

// ============ SERVE FRONTEND ============

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start server
async function start() {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
