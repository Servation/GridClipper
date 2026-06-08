# Domain Terminology

- **AI Filter**: The process of evaluating a video's Thumbnail Grid against a user-defined prompt (e.g., "red car") using a local vision LLM. It can be run automatically as part of a Batch Thumbnail Job or manually on existing Thumbnail Grids.
- **AI Filter Queue**: A dedicated background queue for running the AI Filter on Thumbnail Grids sequentially.
- **Video Tag**: A metadata label assigned to a video when the AI Filter confirms a match for a prompt. Tags are stored in a `metadata.json` file alongside the video, allowing the application to display and sort tagged videos.
- **Source Directory**: The directory containing the original pictures/videos to be evaluated.
- **Output Directory**: The destination directory where matching pictures/grids are copied (Legacy behavior, largely superseded by Video Tags).
- **Thumbnail Grid**: An image containing a grid of frames extracted from a video, including a header with video metadata (name, duration, size, resolution) and timestamped thumbnails. (Formerly known as Contact Sheets).
- **Overall Progress**: The visual/textual progress of analyzing the entire folder of videos (e.g., `[3/10] videos processed`).
- **Current Video Progress**: Detailed real-time tracking of the specific video currently being processed by the Global Job Queue, parsed from the script's output stream.
- **Batch Thumbnail Job**: An asynchronous background process that generates Thumbnail Grids for multiple selected folders/subfolders, optionally running the AI Filter immediately afterward.
- **Video Clip**: A shorter segment extracted from a parent video, defined by a specific Start Time and End Time.
- **Interactive Clipping Tool**: A UI feature that synchronizes manual timestamp inputs, an embedded video player, and a zoomable Thumbnail Grid to define Video Clips.
- **Global Job Queue**: A centralized waiting list for Batch Thumbnail Jobs that processes one directory at a time to optimize CPU usage. It supports pausing, resuming, and appending new directories.
