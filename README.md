# GridClipper

GridClipper is a powerful desktop application that allows you to easily generate Thumbnail Grids (formerly known as Contact Sheets) for your videos, filter and tag them using a local AI Vision model, and precisely extract video clips via an interactive zooming UI.

## Key Features

- **Thumbnail Grids**: Automatically scan your video directories and generate timestamped thumbnail grids.
- **AI Filtering**: Use a local vision LLM (e.g., LM Studio running on `http://localhost:1234/v1`) to automatically identify objects or concepts across thousands of videos. Videos matching your prompts get tagged and stored in metadata.
- **Interactive Clipping Tool**: Click directly on a thumbnail within the grid to jump instantly to that moment in the video. You can drag to pan and scroll to zoom on large grids to find the perfect frame.
- **Background Batch Processing**: Process large directories sequentially using the Global Job Queue to optimize CPU usage. The UI displays real-time processing and clipping progress.
- **Integrated Video Player**: Review clips inside the app, with features like playback speed control, frame stepping, and precise time selection.

## Installation

You can either run GridClipper via the provided Windows executable or from source.

### Run via Executable (Windows)
1. Download the `GridClipper-Release.zip` from the GitHub Releases.
2. Extract the contents.
3. Run `GridClipper.exe`.

### Run from Source
If you wish to run the app from source or modify the code:

1. Install Python and Node.js.
2. Install Python backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Install frontend Node dependencies:
   ```bash
   cd frontend
   npm install
   ```
4. Start the application using the included batch script:
   ```bash
   start_app.bat
   ```

## Requirements

- **FFmpeg & FFprobe**: Required in your system PATH for extracting frames and clipping videos.
- **Vision Model (Optional)**: For the AI Filter capabilities, a local LLM server (like LM Studio) with a vision-capable model is highly recommended.

## Technical Stack
- **Backend**: FastAPI (Python) for background queues and media streaming.
- **Frontend**: React, TypeScript, and Vite for a highly responsive, modern glassmorphism UI.
- **Desktop Wrapper**: PyWebView & PyInstaller for a seamless native-like desktop experience.
