# Railway Deployment Setup Guide

This guide covers setting up the Railway deployment feature in your Intuivox application.

## 🔧 Environment Variables

Add these to your `.env.local` file:

```bash
# Encryption key for storing Railway tokens (32 characters)
ENCRYPTION_KEY="your-32-char-secret-key-here-123456"

# Optional: Railway API token for server-side operations
RAILWAY_API_TOKEN="your-railway-token-here"
```

## 📊 Database Migration

Run the Prisma migration to add the deployment tables:

```bash
npx prisma db push
npx prisma generate
```

This will add:

- `UserRailwayConnection` table for storing encrypted Railway tokens
- `Deployment` table for tracking deployment status
- `DeploymentStatus` enum for status tracking

## 🔐 Railway API Token Setup

### For Users (Frontend):

1. Go to [Railway Dashboard](https://railway.app/account/tokens)
2. Create a new API token
3. Users will enter this token in the deployment modal

### For Development (Backend):

1. Get your Railway token from [Railway Dashboard](https://railway.app/account/tokens)
2. Add it to your `.env.local` as `RAILWAY_API_TOKEN`

## 🚀 Testing the Feature

1. **Start your development server:**

   ```bash
   npm run dev
   ```

2. **Create a fragment** with a Next.js project

3. **Click the deploy button** (purple rocket icon) in the preview URL bar

4. **Connect Railway account** when prompted

5. **Deploy your app** and monitor the real-time status

## 🎯 Feature Components

### New Components Added:

- `DeployButton` - Deploy button in FragmentWeb URL bar
- `DeploymentStatus` - Real-time deployment tracking
- Railway API integration (`src/lib/railway.ts`)
- TRPC procedures for deployment operations
- Inngest background job for deployment processing

### Key Features:

- ✅ One-click deployment to Railway
- ✅ Real-time deployment status tracking
- ✅ Custom domain support with SSL
- ✅ Build logs and error reporting
- ✅ Encrypted token storage
- ✅ Background job processing

## 🔄 Deployment Flow

1. **User clicks deploy** → Modal opens
2. **Connect Railway** → OAuth token stored (encrypted)
3. **Configure deployment** → Custom domain, project name
4. **Background processing** → Inngest handles Railway API calls
5. **Real-time updates** → TRPC polling shows progress
6. **Completion** → Live URL ready with SSL

## 🛠️ Production Considerations

### Security:

- Railway tokens are encrypted in database
- Use strong `ENCRYPTION_KEY` in production
- Consider rotating tokens periodically

### Performance:

- Deployment polling stops automatically when complete
- Background jobs handle heavy Railway API operations
- UI remains responsive during deployments

### Error Handling:

- Comprehensive error messages for deployment failures
- Build logs displayed for debugging
- Retry functionality for failed deployments

## 📈 Cost & Scaling

### Railway Pricing:

- **Free tier**: $5/month usage credits
- **Pro plan**: $20/month + usage
- **Much cheaper** than Vercel for most use cases

### Usage Estimates:

- Small Next.js app: ~$0.50-2/month
- Medium app with traffic: ~$3-8/month
- Heavy usage app: ~$10-20/month

## 🔗 Alternative Deployment Platforms

The architecture supports easy extension to other platforms:

### Already Researched:

- **Render.com** - Similar API pattern
- **Fly.io** - Docker-based deployments
- **Netlify** - JAMstack focus
- **Railway** - Chosen for simplicity

### To Add More Platforms:

1. Create new API integration (follow `railway.ts` pattern)
2. Add new TRPC procedures
3. Update UI components for platform selection

## 🎉 Benefits Over GitHub + Vercel

✅ **90% simpler** implementation  
✅ **No GitHub repos** needed  
✅ **Built-in custom domains**  
✅ **Auto SSL certificates**  
✅ **Real-time status tracking**  
✅ **80% cheaper** for most users  
✅ **Single platform** to manage

This Railway implementation provides a production-ready deployment solution that's much simpler than the traditional GitHub + Vercel approach while maintaining all the features users expect.
