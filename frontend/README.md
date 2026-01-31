# Inspectre Frontend

A modern React frontend for the Inspectre video analysis system.

## Features

- **Chat Interface**: Query videos using natural language
  - Search button (🔍): Find video clips matching your query
  - Send button (→): Analyze videos with AI
- **Time Filtering**: Filter results by date
  - Default: Last 24 hours
  - Select from available dates with data
  - Custom date picker
- **Settings Page**: Configure and control the system
  - RTSP camera link configuration
  - Start/Stop recording
  - Backend status indicator
- **Archives**: View and restore past conversations

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Backend Connection

The frontend connects to the Inspectre backend at `http://localhost:8000` by default.

### Starting the Backend

From the Inspectre root directory:
```bash
python run.py
```

### API Endpoints Used

- `GET /health` - Check backend status
- `GET /recording/status` - Check recording state
- `POST /recording/start` - Start RTSP recording
- `POST /recording/stop` - Stop recording
- `POST /search/clips` - Search for video clips
- `GET /search/available-dates` - Get dates with data
- `POST /analysis` - Analyze videos with AI

## Environment Variables

Create a `.env` file to customize:

```
VITE_API_URL=http://localhost:8000
```

## Project Structure

```
src/
├── components/
│   ├── ChatPage.tsx      # Main chat interface
│   ├── SettingsPage.tsx  # Settings and recording control
│   ├── ArchivesPage.tsx  # Conversation archives
│   └── Sidebar.tsx       # Navigation sidebar
├── services/
│   └── api.ts            # Backend API client
└── App.tsx               # Main application
```

## Usage

### Searching for Clips

1. Type your query in the chat input
2. Click the search icon (🔍)
3. View matching video clips
4. Click a clip to view the video

### Analyzing Videos

1. Type your question in the chat input
2. Click the send button (→)
3. AI will analyze relevant videos and provide insights

### Recording Setup

1. Go to Settings
2. Enter your RTSP camera URL
3. Click "Start Recording"
4. The system will record 10-minute chunks and process them automatically

### Date Filtering

1. Click the clock icon in the top-right
2. Select "Last 24 hours" or choose from available dates
3. Queries will filter to the selected time range
