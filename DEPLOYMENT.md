# Deployment Guide: Vercel + Supabase

This guide will help you deploy your Math Quiz Game to Vercel with Supabase as the database.

## Prerequisites

1. **Supabase Account**: Create a free account at [supabase.com](https://supabase.com)
2. **Vercel Account**: Create a free account at [vercel.com](https://vercel.com)
3. **Git**: Your project should be pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Set Up Supabase

### 1.1 Create a New Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Enter your project details:
   - **Name**: `math-quiz-game` (or your preferred name)
   - **Database Password**: Create a strong password and save it!
   - **Region**: Choose a region closest to your users
4. Click "Create new project" and wait for it to be ready (usually 1-2 minutes)

### 1.2 Set Up the Database

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Copy the contents of [`supabase-setup.sql`](./supabase-setup.sql)
3. Paste it into the SQL Editor
4. Click "Run" to execute the script
5. You should see success messages confirming table creation

### 1.3 Get Your Supabase Credentials

1. Go to **Settings** (gear icon) → **Database**
2. Find the "Connection string" section
3. Copy the **Host** (looks like: `db.xxxxxx.supabase.co`)
4. Note your:
   - **Host**: `db.xxxxxx.supabase.co`
   - **Port**: `5432`
   - **Database**: `postgres`
   - **User**: `postgres`
   - **Password**: The password you set in step 1.1

## Step 2: Set Up Vercel

### 2.1 Deploy Your Project

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New..." → "Project"
3. Import your Git repository
4. Configure the project:
   - **Framework Preset**: Other
   - **Build Command**: Leave empty or use `npm run build`
   - **Output Directory**: Leave empty

### 2.2 Configure Environment Variables

1. In the Vercel deployment screen, find "Environment Variables"
2. Add the following variables:

| Variable | Value |
|----------|-------|
| `DB_HOST` | Your Supabase host (e.g., `db.xxxxxx.supabase.co`) |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | Your Supabase database password |
| `DB_NAME` | `postgres` |
| `DB_PORT` | `5432` |
| `JWT_SECRET` | A secure random string (at least 32 characters) |
| `NODE_ENV` | `production` |

3. Click "Deploy"

## Step 3: Verify Deployment

### 3.1 Check Vercel Dashboard

1. Go to your Vercel project dashboard
2. Click on the latest deployment
3. Check the "Function Logs" tab for any errors

### 3.2 Test Your Application

1. Visit your Vercel URL (e.g., `your-project.vercel.app`)
2. Try to register a new account
3. Try to log in
4. Start a quiz and play

### 3.3 Common Issues

**Database Connection Error**:
- Check that your `DB_HOST` is correct
- Verify the database password is correct
- Make sure Supabase project is not paused

**502 Error**:
- Check Vercel function logs
- Ensure all environment variables are set
- Verify `vercel.json` configuration

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | Supabase database host |
| `DB_USER` | Yes | Database user (usually `postgres`) |
| `DB_PASSWORD` | Yes | Database password |
| `DB_NAME` | Yes | Database name (usually `postgres`) |
| `DB_PORT` | Yes | Database port (usually `5432`) |
| `JWT_SECRET` | Yes | Secret key for JWT tokens |
| `NODE_ENV` | Yes | Set to `production` |

## Local Development

To test locally:

1. Copy `.env.example` to `.env.local`
2. Update the database credentials
3. Run `npm install`
4. Run `npm run dev`
5. Visit `http://localhost:3000`

## Files Modified for Deployment

- [`server.js`](./server.js) - Updated for PostgreSQL compatibility
- [`vercel.json`](./vercel.json) - Vercel deployment configuration
- [`package.json`](./package.json) - Updated dependencies and scripts
- [`supabase-setup.sql`](./supabase-setup.sql) - Database schema for Supabase
- [`.env.example`](./.env.example) - Environment variables template

## Support

If you encounter issues:
1. Check Vercel deployment logs
2. Verify Supabase database is accessible
3. Ensure all environment variables are correctly set
4. Test locally with correct credentials
