const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'math-quiz-game-secret-key-2024';

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Rate limiting
const rateLimit = require('express-rate-limit');

// PostgreSQL Connection Configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: 'Too many requests, please try again later.' },
  validate: { xForwardedForHeader: false }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
  validate: { xForwardedForHeader: false }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// JWT Token verification middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Initialize database tables
async function initDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        theme VARCHAR(50) DEFAULT 'light',
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        difficulty VARCHAR(50) NOT NULL,
        category VARCHAR(100),
        score INTEGER DEFAULT 0,
        time_left INTEGER DEFAULT 0,
        total_questions INTEGER DEFAULT 10,
        correct_answers INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create quiz_questions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES quiz_sessions(id) ON DELETE CASCADE,
        question_number INTEGER NOT NULL,
        question TEXT NOT NULL,
        correct_answer VARCHAR(255) NOT NULL,
        user_answer VARCHAR(255),
        is_correct BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create user_stats table
    await pool.query(`
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
      )
    `);

    // Create achievements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        points INTEGER DEFAULT 0,
        requirement_type VARCHAR(100),
        requirement_value INTEGER DEFAULT 0,
        icon VARCHAR(100)
      )
    `);

    // Create user_achievements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
        earned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
      )
    `);

    // Insert default achievements if not exists
    const achievements = [
      { name: 'First Steps', description: 'Complete your first quiz', points: 10, requirement_type: 'games', requirement_value: 1, icon: 'trophy' },
      { name: 'Getting Good', description: 'Score 50 points in a single quiz', points: 20, requirement_type: 'score', requirement_value: 50, icon: 'star' },
      { name: 'Quiz Master', description: 'Complete 10 quizzes', points: 50, requirement_type: 'games', requirement_value: 10, icon: 'medal' },
      { name: 'High Scorer', description: 'Get a score of 100', points: 100, requirement_type: 'score', requirement_value: 100, icon: 'crown' },
      { name: 'Perfect Score', description: 'Answer all questions correctly', points: 150, requirement_type: 'perfect', requirement_value: 1, icon: 'star' },
      { name: 'Speed Demon', description: 'Complete a quiz with time left', points: 30, requirement_type: 'time', requirement_value: 30, icon: 'flash' },
      { name: 'Dedicated Player', description: 'Play 50 quizzes', points: 200, requirement_type: 'games', requirement_value: 50, icon: 'fire' }
    ];

    for (const ach of achievements) {
      await pool.query(
        `INSERT INTO achievements (name, description, points, requirement_type, requirement_value, icon)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [ach.name, ach.description, ach.points, ach.requirement_type, ach.requirement_value, ach.icon]
      );
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Auth middleware wrapper
const authLimiterMiddleware = (req, res, next) => authLimiter(req, res, next);
const loginLimiterMiddleware = (req, res, next) => loginLimiter(req, res, next);

// Register endpoint
app.post('/api/auth/register', loginLimiterMiddleware, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const existingUsers = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    if (existingUsers.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insert new user
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), normalizedEmail, hashedPassword]
    );

    const user = result.rows[0];

    // Initialize user stats
    await pool.query(
      'INSERT INTO user_stats (user_id) VALUES ($1)',
      [user.id]
    );

    // Generate token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/api/auth/login', loginLimiterMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const users = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_deleted = FALSE',
      [normalizedEmail]
    );

    const user = users.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

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

// Get all users (for admin display)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, email, theme, is_deleted, deleted_at, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const [users] = await pool.query('SELECT id, name, email, theme, is_deleted, deleted_at, created_at FROM users WHERE id = ?', [userId]);
    res.json(users[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore account
app.post('/api/users/restore', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_deleted = FALSE, deleted_at = NULL WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account restored' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Soft delete account
app.delete('/api/users', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update theme
app.put('/api/users/theme', authenticateToken, async (req, res) => {
  try {
    const { theme } = req.body;
    await pool.query('UPDATE users SET theme = ? WHERE id = ?', [theme, req.user.id]);
    res.json({ success: true, theme });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate quiz questions
app.post('/api/quiz/start', authLimiterMiddleware, authenticateToken, async (req, res) => {
  try {
    const { difficulty, category } = req.body;
    const questions = [];
    const operators = ['+', '-', '*', '/'];
    const difficultySettings = {
      easy: { maxNum: 10, time: 60 },
      medium: { maxNum: 25, time: 45 },
      hard: { maxNum: 50, time: 30 }
    };

    const settings = difficultySettings[difficulty] || difficultySettings.easy;
    const numQuestions = 10;

    for (let i = 0; i < numQuestions; i++) {
      const operator = operators[Math.floor(Math.random() * operators.length)];
      let num1 = Math.floor(Math.random() * settings.maxNum) + 1;
      let num2 = Math.floor(Math.random() * settings.maxNum) + 1;
      let question, answer;

      if (operator === '/') {
        num1 = num1 * num2;
        question = `${num1} ÷ ${num2}`;
        answer = (num1 / num2).toString();
      } else if (operator === '-') {
        if (num2 > num1) [num1, num2] = [num2, num1];
        question = `${num1} - ${num2}`;
        answer = (num1 - num2).toString();
      } else if (operator === '*') {
        num1 = Math.floor(Math.random() * 12) + 1;
        num2 = Math.floor(Math.random() * 12) + 1;
        question = `${num1} × ${num2}`;
        answer = (num1 * num2).toString();
      } else {
        question = `${num1} + ${num2}`;
        answer = (num1 + num2).toString();
      }

      questions.push({ question, answer });
    }

    const [result] = await pool.query(
      'INSERT INTO quiz_sessions (user_id, difficulty, category, score, time_left, total_questions) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, difficulty, category, 0, settings.time, numQuestions]
    );

    const sessionId = result.insertId;

    for (let i = 0; i < questions.length; i++) {
      await pool.query(
        'INSERT INTO quiz_questions (session_id, question_number, question, correct_answer) VALUES (?, ?, ?, ?)',
        [sessionId, i + 1, questions[i].question, questions[i].answer]
      );
    }

    res.json({
      success: true,
      sessionId,
      questions: questions.map((q, i) => ({ number: i + 1, question: q.question })),
      timeLeft: settings.time
    });
  } catch (error) {
    console.error('Quiz start error:', error);
    res.status(500).json({ error: 'Failed to start quiz' });
  }
});

// Submit answer
app.post('/api/quiz/answer', authLimiterMiddleware, authenticateToken, async (req, res) => {
  try {
    const { sessionId, questionNumber, userAnswer } = req.body;

    const [sessions] = await pool.query(
      'SELECT id FROM quiz_sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const [questions] = await pool.query(
      'SELECT id, correct_answer FROM quiz_questions WHERE session_id = ? AND question_number = ?',
      [sessionId, questionNumber]
    );

    if (questions.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const question = questions[0];
    const isCorrect = userAnswer.trim() === question.correct_answer.trim();

    await pool.query(
      'UPDATE quiz_questions SET user_answer = ?, is_correct = ? WHERE id = ?',
      [userAnswer, isCorrect, question.id]
    );

    if (isCorrect) {
      await pool.query(
        'UPDATE quiz_sessions SET score = score + 10 WHERE id = ?',
        [sessionId]
      );
    }

    res.json({
      success: true,
      isCorrect,
      correctAnswer: question.correct_answer
    });
  } catch (error) {
    console.error('Answer submission error:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// Submit quiz
app.post('/api/quiz/submit', authLimiterMiddleware, authenticateToken, async (req, res) => {
  try {
    const { sessionId, timeLeft } = req.body;

    const [sessions] = await pool.query(
      'SELECT score, time_left FROM quiz_sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.user.id]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await pool.query(
      'UPDATE quiz_sessions SET score = ?, time_left = ? WHERE id = ?',
      [sessions[0].score, timeLeft, sessionId]
    );

    // Update stats
    await pool.query(`
      INSERT INTO user_stats (user_id, total_games, total_score, highest_score, total_questions_answered, total_correct_answers, average_score)
      VALUES (?, 1, ?, ?, 10, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        total_games = user_stats.total_games + 1,
        total_score = user_stats.total_score + ?,
        highest_score = GREATEST(user_stats.highest_score, ?),
        total_questions_answered = user_stats.total_questions_answered + 10,
        total_correct_answers = user_stats.total_correct_answers + ?,
        average_score = (user_stats.total_score + ?) / (user_stats.total_games + 1)
    `, [req.user.id, sessions[0].score, sessions[0].score, 0, sessions[0].score, sessions[0].score, 0, sessions[0].score]);

    res.json({
      success: true,
      score: sessions[0].score,
      timeLeft
    });
  } catch (error) {
    console.error('Quiz submission error:', error);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// Get quiz history
app.get('/api/quiz/history', authenticateToken, async (req, res) => {
  try {
    const [sessions] = await pool.query(
      'SELECT * FROM quiz_sessions WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all quiz sessions
app.get('/api/quiz/all-sessions', authenticateToken, async (req, res) => {
  try {
    const [sessions] = await pool.query(
      'SELECT qs.*, u.name as user_name FROM quiz_sessions qs JOIN users u ON qs.user_id = u.id ORDER BY qs.created_at DESC'
    );
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete quiz session
app.delete('/api/quiz/session/:id', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.params.id;
    await pool.query('DELETE FROM quiz_sessions WHERE id = ? AND user_id = ?', [sessionId, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all scores
app.get('/api/scores', authenticateToken, async (req, res) => {
  try {
    const [scores] = await pool.query(
      'SELECT * FROM quiz_sessions WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all scores from all users
app.get('/api/scores/all', authenticateToken, async (req, res) => {
  try {
    const [scores] = await pool.query(
      'SELECT qs.*, u.name as user_name FROM quiz_sessions qs JOIN users u ON qs.user_id = u.id ORDER BY qs.score DESC'
    );
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get questions for a specific session
app.get('/api/quiz/session/:id/questions', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.params.id;

    const [sessions] = await pool.query(
      'SELECT qs.*, u.name as user_name FROM quiz_sessions qs JOIN users u ON qs.user_id = u.id WHERE qs.id = ?',
      [sessionId]
    );

    const [questions] = await pool.query(
      'SELECT * FROM quiz_questions WHERE session_id = ? ORDER BY question_number',
      [sessionId]
    );

    res.json({ session: sessions[0], questions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all user data
app.delete('/api/user/delete-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await pool.query('DELETE FROM quiz_sessions WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_achievements WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_stats WHERE user_id = ?', [userId]);

    res.json({ success: true, message: 'All user data deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a specific session
app.delete('/api/quiz/session/:id/remove', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user.id;

    const [sessions] = await pool.query(
      'SELECT * FROM quiz_sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const deletedSession = sessions[0];

    await pool.query('DELETE FROM quiz_sessions WHERE id = ?', [sessionId]);

    // Recalculate stats
    const [remainingSessions] = await pool.query(
      'SELECT SUM(score) as total_score, COUNT(*) as games_count FROM quiz_sessions WHERE user_id = ?',
      [userId]
    );

    const totalScore = remainingSessions[0].total_score || 0;
    const totalGames = remainingSessions[0].games_count || 0;
    const averageScore = totalGames > 0 ? Math.round(totalScore / totalGames) : 0;

    if (totalGames === 0) {
      await pool.query(`
        UPDATE user_stats SET
          total_games = 0,
          total_score = 0,
          highest_score = 0,
          total_questions_answered = 0,
          total_correct_answers = 0,
          average_score = 0
        WHERE user_id = ?
      `, [userId]);

      await pool.query('DELETE FROM user_achievements WHERE user_id = ?', [userId]);
    } else {
      await pool.query(`
        UPDATE user_stats SET
          total_score = ?,
          total_games = ?,
          average_score = ?
        WHERE user_id = ?
      `, [totalScore, totalGames, averageScore, userId]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
app.get('/api/scores/ranking', authenticateToken, async (req, res) => {
  try {
    const [rankings] = await pool.query(`
      SELECT u.id as user_id, u.name as username,
        COALESCE(us.highest_score, 0) as highest_score,
        COALESCE(us.total_games, 0) as total_games,
        COALESCE(us.average_score, 0) as average_score
      FROM users u
      LEFT JOIN user_stats us ON u.id = us.user_id
      WHERE u.is_deleted = FALSE
      ORDER BY highest_score DESC
      LIMIT 10
    `);
    res.json(rankings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize user stats
async function initUserStats(userId) {
  await pool.query('INSERT INTO user_stats (user_id) VALUES (?)', [userId]);
}

// Get user stats
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);

    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
    }

    res.json(stats[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user achievements
app.get('/api/achievements', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [allAchievements] = await pool.query('SELECT * FROM achievements ORDER BY points');

    const [userAchievements] = await pool.query(
      'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
      [userId]
    );

    const earnedIds = new Set(userAchievements.map(a => a.achievement_id));

    const achievements = allAchievements.map(ach => ({
      ...ach,
      earned: earnedIds.has(ach.id),
      earnedAt: null
    }));

    for (let i = 0; i < achievements.length; i++) {
      if (achievements[i].earned) {
        const [earned] = await pool.query(
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
    res.status(500).json({ error: error.message });
  }
});

// Check and award achievements
app.post('/api/achievements/check', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);

    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
    }

    const userStats = stats[0];

    const [achievements] = await pool.query(
      'SELECT * FROM achievements WHERE requirement_type = ? AND requirement_value <= ?',
      ['games', userStats.total_games]
    );

    for (const achievement of achievements) {
      const [existing] = await pool.query(
        'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
        [userId, achievement.id]
      );

      if (existing.length === 0) {
        await pool.query(
          'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
          [userId, achievement.id]
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);

    if (stats.length === 0) {
      await initUserStats(userId);
      [stats] = await pool.query('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
    }

    const [user] = await pool.query('SELECT id, name, email, theme FROM users WHERE id = ?', [userId]);

    res.json({ ...user[0], ...stats[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// For local development
if (process.env.NODE_ENV !== 'production') {
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
}

// Export for Vercel
module.exports = app;
