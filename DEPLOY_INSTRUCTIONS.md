# Deploy Backend to Render

## Option 1: Connect GitHub Repo to Render (Recommended)

1. Go to https://dashboard.render.com
2. Click your **wordpress-claw** service
3. Click **"Settings"** tab
4. Under **"Build & Deploy"**, look for **Git Repository**
5. If it shows "Manual Deploy", you need to connect GitHub:
   - Click **"Connect"** next to GitHub
   - Select your repository: **xBalzerian/wordpress-claw-backend**
   - Click **Connect**

6. Once connected, every push to GitHub will auto-deploy

## Option 2: Manual Deploy (Right Now)

1. Go to https://dashboard.render.com
2. Click your **wordpress-claw** service
3. Click **"Manual Deploy"** button (top right)
4. Select **"Deploy latest commit"**
5. Wait for deployment to finish

## Option 3: Deploy via Render API

If you have Render API key, you can trigger deploy programmatically.

## Verify Deployment

After deploy, test these URLs:
- https://wordpress-claw.onrender.com/api/health
- https://wordpress-claw.onrender.com/api/auth/google (should redirect to Google, not show "Cannot GET")

## Current Issue

The backend code has the OAuth routes, but the deployed version doesn't because:
1. Code is committed locally but not pushed to GitHub
2. Render deploys from GitHub, not local code

## Quick Fix

**You need to either:**
1. Push the backend code to GitHub (requires GitHub auth)
2. Or use Render's "Deploy from GitHub" feature
3. Or manually upload the code to Render

## Alternative: Direct Deploy

If GitHub push isn't working, you can:
1. Go to Render dashboard
2. Create a **new Web Service**
3. Select **"Deploy from GitHub"**
4. Choose **xBalzerian/wordpress-claw-backend**
5. Set environment variables again
6. Deploy

Then update your frontend to use the new service URL.
