const numFiles = 10000;
const numRunningJobs = 100;
const numQueuedJobs = 500;

// Generate dummy data
const files = Array.from({ length: numFiles }, (_, i) => ({
  name: `file_${i}.mp4`,
  path: `C:\\videos\\folder\\file_${i}.mp4`
}));

const jobStatus = { status: 'running', current_video: 'file_10.mp4' };

const clipJobStatus = {
  running: Array.from({ length: numRunningJobs }, (_, i) => ({
    video_path: `C:\\videos\\folder\\file_${Math.floor(Math.random() * numFiles)}.mp4`
  })),
  queue: Array.from({ length: numQueuedJobs }, (_, i) => ({
    video_path: `C:\\videos\\folder\\file_${Math.floor(Math.random() * numFiles)}.mp4`
  }))
};

console.log("Measuring Baseline...");
const startBaseline = performance.now();

const baselineResults = files.map(f => {
  const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
  const isProcessing = jobStatus.status === 'running' && jobStatus.current_video === f.name;
  const isClipping = clipJobStatus.running?.some((job) => normalizePath(job.video_path) === normalizePath(f.path));
  const isClipQueued = clipJobStatus.queue?.some((job) => normalizePath(job.video_path) === normalizePath(f.path));

  return { isProcessing, isClipping, isClipQueued };
});

const endBaseline = performance.now();
console.log(`Baseline time: ${(endBaseline - startBaseline).toFixed(2)} ms`);


console.log("Measuring Optimized...");
const startOptimized = performance.now();

const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();

// Pre-compute sets
const runningSet = new Set(clipJobStatus.running?.map(job => normalizePath(job.video_path)) || []);
const queueSet = new Set(clipJobStatus.queue?.map(job => normalizePath(job.video_path)) || []);

const optimizedResults = files.map(f => {
  const isProcessing = jobStatus.status === 'running' && jobStatus.current_video === f.name;

  const normalizedFilePath = normalizePath(f.path);
  const isClipping = runningSet.has(normalizedFilePath);
  const isClipQueued = queueSet.has(normalizedFilePath);

  return { isProcessing, isClipping, isClipQueued };
});

const endOptimized = performance.now();
console.log(`Optimized time: ${(endOptimized - startOptimized).toFixed(2)} ms`);
