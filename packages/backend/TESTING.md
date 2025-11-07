# Testing the Post Metadata Extraction Workflow

This guide explains how to test the AI-powered post metadata extraction workflow.

## Prerequisites

1. **Start Convex Dev Server**:
   ```bash
   cd packages/backend
   pnpm dev
   ```

2. **Set Environment Variables**:
   Make sure `GOOGLE_GENERATIVE_AI_API_KEY` is set in your Convex environment:
   ```bash
   npx convex env set GOOGLE_GENERATIVE_AI_API_KEY "your-api-key-here"
   ```

3. **Register Components**:
   The components (agent, workflow, migrations) should be automatically registered when you run `convex dev`. If not, check the Convex dashboard.

## Testing Methods

### Method 1: Using Convex Dashboard

1. Open the Convex Dashboard: https://dashboard.convex.dev
2. Navigate to your project
3. Go to the "Functions" tab
4. Find `test:testCreatePostAndExtractMetadata`
5. Click "Run" and provide a test caption, for example:
   ```json
   {
     "caption": "🎉 Join us for an amazing concert this Friday, March 15th at 8 PM at the Music Hall! Tickets available at ticketmaster.com. #concert #music #live",
     "url": "https://instagram.com/p/example123"
   }
   ```
6. This will:
   - Create a test post
   - Start the metadata extraction workflow
   - Return the `postId` and `workflowId`

### Method 2: Using Convex CLI

```bash
# Create a test post and start workflow
npx convex run test:testCreatePostAndExtractMetadata \
  '{"caption": "🎉 Join us for an amazing concert this Friday, March 15th at 8 PM at the Music Hall! Tickets available at ticketmaster.com. #concert #music #live", "url": "https://instagram.com/p/example123"}'

# Check workflow status (replace WORKFLOW_ID with the returned workflowId)
npx convex run test:getWorkflowStatus '{"workflowId": "WORKFLOW_ID"}'

# Check the extracted metadata (replace POST_ID with the returned postId)
npx convex run test:checkTestPostMetadata '{"postId": "POST_ID"}'
```

### Method 3: Test with Existing Post

If you already have a post in your database:

```bash
# Start workflow for existing post
npx convex run test:testProcessPostMetadata '{"postId": "YOUR_POST_ID"}'

# Check status
npx convex run test:getWorkflowStatus '{"workflowId": "WORKFLOW_ID"}'
```

## Checking Results

### View Workflow Status

The workflow status will show:
- `inProgress`: Workflow is still running
- `completed`: Workflow finished successfully
- `failed`: Workflow encountered an error

### View Extracted Metadata

Use the `post_metadata:getPostMetadata` query to see the extracted data:

```bash
npx convex run post_metadata:getPostMetadata '{"postId": "YOUR_POST_ID"}'
```

Or use the test query:
```bash
npx convex run test:checkTestPostMetadata '{"postId": "YOUR_POST_ID"}'
```

### Expected Metadata Fields

The extracted metadata should include:
- `event_score`: 0-100 confidence score
- `event_title`: Extracted event title
- `event_description`: Event description
- `event_date_start`: Start date timestamp
- `event_time_start`: Start time string
- `location`: Venue name
- `location_address`: Full address
- `ticket_price`: Price information
- `registration_url`: Registration/ticket URL
- `organizer_name`: Organizer name
- `hashtags`: Array of hashtags
- `telegram_message`: Formatted Telegram message
- `processing_status`: "completed", "processing", "failed", or "pending"

## Example Test Captions

### High Event Score (80-100)
```
🎉 Join us for an amazing concert this Friday, March 15th at 8 PM at the Music Hall! 
Tickets available at ticketmaster.com. #concert #music #live
```

### Medium Event Score (50-79)
```
Check out this cool workshop happening next week! #workshop #learning
```

### Low Event Score (0-49)
```
Beautiful sunset today! #nature #photography
```

## Troubleshooting

### Workflow Not Starting
- Check that components are registered in `convex.config.ts`
- Verify `convex dev` is running
- Check Convex dashboard for component registration status

### API Key Issues
- Verify `GOOGLE_GENERATIVE_AI_API_KEY` is set: `npx convex env ls`
- Check the key is valid and has quota remaining

### Workflow Failing
- Check workflow status for error messages
- Look at Convex logs in the dashboard
- Verify the post has a valid caption and URL

### Metadata Not Extracted
- Check `processing_status` in the metadata record
- Look at `processing_error` field for details
- Verify the caption contains event-related information

## Monitoring

You can monitor workflow progress in the Convex dashboard:
1. Go to "Functions" → "Workflows"
2. Find your workflow by ID
3. View step-by-step execution
4. Check logs for each step

## Next Steps

After successful testing:
1. Integrate workflow trigger into `posts:upsertPost` mutation
2. Set up cron job for backlog processing
3. Configure settings for batch processing

