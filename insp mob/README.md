# Inspectre Mobile App

A professional React Native mobile app for AI-powered CCTV analysis. Ask questions to your CCTV system and get intelligent responses.

## Features

- **Video Search**: Get modern video card responses with relevant footage information
- **AI Analysis**: Receive comprehensive LLM-powered analysis based on CCTV evidence
- **Professional Dark UI**: Sleek, professional interface optimized for security applications
- **Dual Query Types**: 
  - 🔍 Search queries for video footage results
  - 📤 Send queries for detailed AI analysis

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- Expo CLI
- iOS Simulator (for iOS testing) or Android Studio/emulator (for Android testing)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install Expo CLI globally (if not already installed):**
   ```bash
   npm install -g expo-cli
   ```

### Running the App

1. **Start the Expo development server:**
   ```bash
   npm start
   ```

2. **Run on specific platforms:**
   ```bash
   # iOS
   npm run ios

   # Android  
   npm run android

   # Web
   npm run web
   ```

3. **Using Expo Go app:**
   - Install Expo Go on your mobile device
   - Scan the QR code displayed in the terminal/browser

## App Structure

```
inspectre-mobile/
├── components/
│   └── EyeIcon.js          # Professional eye logo component
├── utils/
│   └── dummyResponses.js   # Mock responses for development
├── assets/                 # App icons and images
├── App.js                  # Main app component
├── package.json
├── app.json               # Expo configuration
└── babel.config.js
```

## Usage

1. **Launch the app** - You'll see the professional dark interface with the Inspectre eye logo
2. **Type your question** in the input field at the bottom
3. **Choose query type:**
   - **🔍 Search button**: Get video search results with footage cards
   - **📤 Send button**: Get detailed AI analysis with evidence

### Example Queries

- "Show me people near the entrance today"
- "Any suspicious activity in the parking lot?"
- "What happened at the loading dock this morning?"
- "Check for unauthorized access attempts"

## Technical Details

- **Framework**: React Native with Expo
- **UI Theme**: Professional dark theme matching security industry standards
- **Icons**: Expo Vector Icons
- **Graphics**: React Native SVG for custom eye logo
- **Responsive**: Optimized for mobile devices

## Development Notes

- Currently uses dummy responses for both query types
- Professional styling matches the provided design specifications
- Ready for backend integration when API endpoints are available
- Implements proper keyboard handling and loading states

## Future Enhancements

- Real API integration
- Video player for footage playback
- Push notifications for alerts
- User authentication
- Camera stream integration
- Advanced filtering and search options

## Support

For technical issues or questions, contact the development team.