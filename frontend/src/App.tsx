import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  Folder, Film, ChevronRight, 
  Trash2, Play, X, Scissors, FolderOpen, Pause, Menu, ChevronLeft, Square, Loader2, Eye, EyeOff
} from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  has_contact_sheet: boolean;
  size_bytes: number;
  modified_time?: number;
  clip_count?: number;
  tags?: string[];
  ai_matches?: Record<string, string[]>;
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return localStorage.getItem('lastPath') || 'D:/thumbnail-filter';
  });
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  
  const [sortMode, setSortMode] = useState<'name' | 'date'>('name');
  const [clipJobStatus, setClipJobStatus] = useState<any>({ queue: [], running: [] });
  const [sortAsc, setSortAsc] = useState(true);
  
  // Pre-compute sets for efficient O(1) lookups
  const { runningSet, queueSet, normalizePath } = useMemo(() => {
    const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const runningSet = new Set(clipJobStatus?.running?.map((job: any) => normalizePath(job.video_path)) || []);
    const queueSet = new Set(clipJobStatus?.queue?.map((job: any) => normalizePath(job.video_path)) || []);
    return { runningSet, queueSet, normalizePath };
  }, [clipJobStatus]);

  const [showBatchModal, setShowBatchModal] = useState(false);
  
  const [skipExisting, setSkipExisting] = useState<boolean>(() => {
    const saved = localStorage.getItem('skipExisting');
    return saved !== null ? saved === 'true' : true;
  });
  
  const [interval, setIntervalVal] = useState<number>(() => {
    return Number(localStorage.getItem('batchInterval')) || 60;
  });
  
  const [clippingVideo, setClippingVideo] = useState<FileItem | null>(null);
  const [jobStatus, setJobStatus] = useState({ status: 'idle', queue_length: 0, current_video: null });
  
  const [runAIFilter, setRunAIFilter] = useState<boolean>(() => {
    const saved = localStorage.getItem('runAIFilter');
    return saved !== null ? saved === 'true' : false;
  });
  const [aiApiUrl, setAiApiUrl] = useState<string>(() => localStorage.getItem('aiApiUrl') || 'http://localhost:1234/v1');
  const [aiApiKey, setAiApiKey] = useState<string>(() => localStorage.getItem('aiApiKey') || 'lm-studio');
  const [aiModel, setAiModel] = useState<string>(() => localStorage.getItem('aiModel') || 'gemma-4-e4b-uncensored-hauhaucs-aggressive');
  const [aiPrompt, setAiPrompt] = useState<string>(() => localStorage.getItem('aiPrompt') || '');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => localStorage.setItem('runAIFilter', runAIFilter.toString()), [runAIFilter]);
  useEffect(() => localStorage.setItem('aiApiUrl', aiApiUrl), [aiApiUrl]);
  useEffect(() => localStorage.setItem('aiApiKey', aiApiKey), [aiApiKey]);
  useEffect(() => localStorage.setItem('aiModel', aiModel), [aiModel]);
  useEffect(() => localStorage.setItem('aiPrompt', aiPrompt), [aiPrompt]);
  
  const openClip = (v: FileItem) => {
    setClippingVideo(v);
  };

  const closeClip = () => {
    const path = clippingVideo?.path;
    setClippingVideo(null);
    
    // Jump back to the exact video that was clicked
    if (path) {
      setTimeout(() => {
        const id = `video-card-${encodeURIComponent(path).replace(/[^a-zA-Z0-9]/g, '_')}`;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }, 50);
    }
  };
  
  useEffect(() => {
    localStorage.setItem('lastPath', currentPath);
    fetchFiles(currentPath);
    
    const timer = setInterval(() => {
      fetchFiles(currentPath, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [currentPath]);

  useEffect(() => {
    localStorage.setItem('skipExisting', skipExisting.toString());
  }, [skipExisting]);

  useEffect(() => {
    localStorage.setItem('batchInterval', interval.toString());
  }, [interval]);

  useEffect(() => {
    const timer = setInterval(() => {
      axios.get(`${API_BASE}/jobs/status`)
        .then(res => setJobStatus(res.data))
        .catch(err => console.error("Error fetching job status:", err));
        
      axios.get(`${API_BASE}/clip/jobs`)
        .then(res => setClipJobStatus(res.data))
        .catch(err => console.error("Error fetching clip job status:", err));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchFiles = async (dirPath: string, isRefresh = false) => {
    try {
      const res = await axios.get(`${API_BASE}/files`, { params: { dir_path: dirPath } });
      setFiles(res.data);
      if (!isRefresh) {
        // Only clear selections when actively navigating, not on background refresh
        setSelectedPaths(new Set());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleNavigate = (newPath: string) => {
    setCurrentPath(newPath);
  };

  const navigateUp = () => {
    // Normalize backslashes to forward slashes
    let normalized = currentPath.replace(/\\/g, '/');
    // Remove trailing slash if any
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) {
      // Reached a root path like "D:" or "/" or empty
      handleNavigate(normalized.endsWith(':') ? normalized + '/' : (normalized || 'C:/'));
    } else {
      const parent = normalized.substring(0, lastSlash);
      // If parent is just "D:", append a slash so the OS recognizes it as a root directory
      if (parent.endsWith(':')) {
        handleNavigate(parent + '/');
      } else {
        handleNavigate(parent);
      }
    }
  };

  const browseFolder = async () => {
    try {
      const res = await axios.get(`${API_BASE}/select-folder`);
      if (res.data.path) {
        setCurrentPath(res.data.path);
      }
    } catch (err) {
      console.error("Error opening folder browser", err);
    }
  };

  const toggleSelect = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const selectAll = () => {
    const next = new Set(selectedPaths);
    const videos = files.filter(f => !f.is_dir);
    
    // Toggle all videos: if all are selected, deselect them. Otherwise, select them all.
    const allSelected = videos.length > 0 && videos.every(v => next.has(v.path));
    
    if (allSelected) {
      videos.forEach(v => next.delete(v.path));
    } else {
      videos.forEach(v => next.add(v.path));
    }
    
    setSelectedPaths(next);
  };

  const deleteSelectedVideos = async () => {
    if (!window.confirm(`Delete ${selectedPaths.size} items?`)) return;
    for (const path of selectedPaths) {
      try {
        await axios.delete(`${API_BASE}/files`, { params: { path } });
      } catch (err) { console.error(err); }
    }
    setSelectedPaths(new Set());
    fetchFiles(currentPath);
  };

  const startBatchJob = async () => {
    try {
      await axios.post(`${API_BASE}/batch-thumbnail`, {
        source_dirs: Array.from(selectedPaths),
        interval: interval,
        skip_existing: skipExisting,
        run_ai_filter: runAIFilter,
        ai_api_url: aiApiUrl,
        ai_api_key: aiApiKey,
        ai_model: aiModel,
        ai_prompt: aiPrompt
      });
      setShowBatchModal(false);
      // Deselect paths to avoid accidentally running again
      setSelectedPaths(new Set());
    } catch (err) {
      console.error(err);
      alert('Error starting batch job');
    }
  };

  const startAIFilterBatch = async () => {
    if (!aiPrompt) {
      alert('Please enter an AI Search Prompt.');
      return;
    }
    if (selectedPaths.size === 0) {
      alert('Please select at least one video to filter.');
      return;
    }
    try {
      await axios.post(`${API_BASE}/ai-filter`, {
        source_paths: Array.from(selectedPaths),
        ai_api_url: aiApiUrl,
        ai_api_key: aiApiKey,
        ai_model: aiModel,
        ai_prompt: aiPrompt
      });
      alert(`AI Filter started on ${selectedPaths.size} items!`);
      // Optional: setSelectedPaths(new Set());
    } catch (err) {
      console.error(err);
      alert('Error starting AI filter');
    }
  };

  const pauseJobs = async () => {
    await axios.post(`${API_BASE}/jobs/pause`);
  };

  const resumeJobs = async () => {
    await axios.post(`${API_BASE}/jobs/resume`);
  };

  const deleteVideo = async (path: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this video and its contact sheet?")) return;
    try {
      await axios.delete(`${API_BASE}/files`, { params: { path } });
      setFiles(prev => prev.filter(f => f.path !== path));
      setSelectedPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } catch (err) {
      console.error(err);
      alert("Failed to delete video. It might be open in another program or processing.");
    }
  };

  // --- Render Functions --- //

  return (
    <>
      <div className="app-container" style={{ display: clippingVideo ? 'none' : 'flex' }}>
      <div className="sidebar" style={{ width: isNavCollapsed ? '60px' : '320px', minWidth: isNavCollapsed ? '60px' : '320px', transition: 'width 0.3s ease, min-width 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: isNavCollapsed ? '0' : '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: isNavCollapsed ? 'center' : 'space-between', alignItems: 'center', marginBottom: '1rem', padding: isNavCollapsed ? '1rem 0.5rem 0' : '1rem 1rem 0', flexShrink: 0 }}>
          {!isNavCollapsed && <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Folder size={20} /> Navigation</h2>}
          <button className="glass-button" onClick={() => setIsNavCollapsed(!isNavCollapsed)} style={{ padding: '0.4rem' }}>
            {isNavCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>
        
        {!isNavCollapsed && (
          <div style={{ padding: '0 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>


            <div className="glass-panel directories-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', maxHeight: '50vh' }}>
              <div className="path-input-group" style={{ marginBottom: '1rem' }}>
                <input 
                  type="text" 
                  className="glass-input" 
                  value={currentPath}
                  onChange={(e) => setCurrentPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchFiles(currentPath)}
                />
                <button className="glass-button" onClick={browseFolder} title="Browse Directory">
                  <FolderOpen size={18} />
                </button>
                <button className="glass-button" onClick={() => fetchFiles(currentPath)} title="Go">
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="file-list">
                <div className="file-item" onClick={navigateUp}>
                  <Folder className="file-icon" size={18} />
                  <span className="file-name">.. (Up)</span>
                </div>

                {files.filter(f => f.is_dir).map(f => (
                  <div key={f.path} className={`file-item ${selectedPaths.has(f.path) ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedPaths.has(f.path)} onChange={() => toggleSelect(f.path)} style={{ marginRight: '8px', cursor: 'pointer' }} />
                    <div style={{ display: 'flex', alignItems: 'center', flexGrow: 1, cursor: 'pointer' }} onClick={() => handleNavigate(f.path)}>
                      <Folder className="file-icon" size={18} />
                      <span className="file-name">{f.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#a5b4fc' }}>AI Filter Settings</span>
              </div>
              
              <div className="path-input-group">
                <input 
                  type="text" 
                  className="glass-input" 
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem' }} 
                  placeholder="API URL (e.g. http://localhost:1234/v1)"
                  value={aiApiUrl}
                  onChange={(e) => setAiApiUrl(e.target.value)}
                />
              </div>

              <div className="path-input-group" style={{ display: 'flex', gap: '0.25rem' }}>
                <input 
                  type={showApiKey ? "text" : "password"} 
                  className="glass-input" 
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem' }} 
                  placeholder="API Key"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                />
                <button 
                  className="glass-button" 
                  style={{ padding: '0.5rem', flexShrink: 0 }} 
                  onClick={() => setShowApiKey(!showApiKey)}
                  title={showApiKey ? "Hide API Key" : "Show API Key"}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div className="path-input-group">
                <input 
                  type="text" 
                  className="glass-input" 
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem' }} 
                  placeholder="Model Name"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                />
              </div>

              <div className="path-input-group">
                <input 
                  type="text" 
                  className="glass-input" 
                  style={{ width: '100%', fontSize: '0.8rem', padding: '0.5rem', border: '1px solid #6366f1' }} 
                  placeholder="Search Prompt (e.g. 'red car')"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input 
                  type="checkbox" 
                  id="run-ai-batch"
                  checked={runAIFilter} 
                  onChange={(e) => setRunAIFilter(e.target.checked)} 
                  className="glass-checkbox"
                />
                <label htmlFor="run-ai-batch" style={{ fontSize: '0.85rem', cursor: 'pointer', opacity: 0.8 }}>
                  Run after generating thumbnails
                </label>
              </div>

              <button 
                className="glass-button" 
                style={{ width: '100%', marginTop: '0.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', border: '1px solid rgba(168, 85, 247, 0.4)', background: 'rgba(168, 85, 247, 0.1)' }} 
                onClick={startAIFilterBatch}
                disabled={selectedPaths.size === 0}
              >
                Run Filter on Selected ({selectedPaths.size})
              </button>
            </div>

            <div className="glass-panel" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Job Status</h3>
              </div>
              <div className="status-badge" style={{ marginBottom: '1rem' }}>
                Status: <span style={{ color: jobStatus.status === 'running' ? '#4ade80' : jobStatus.status === 'paused' ? '#fbbf24' : '#a78bfa', fontWeight: 'bold', textTransform: 'uppercase', marginLeft: '0.5rem' }}>{jobStatus.status}</span>
              </div>
              {jobStatus.status === 'running' && jobStatus.current_video && (
                <div style={{ fontSize: '0.85rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px' }}>
                  <div style={{ opacity: 0.7, marginBottom: '0.2rem' }}>Processing:</div>
                  <div style={{ wordBreak: 'break-all' }}>{jobStatus.current_video}</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#a78bfa' }}>Items in queue: {jobStatus.queue_length}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="glass-button" style={{ flex: 1, display: 'flex', justifyContent: 'center' }} onClick={() => jobStatus.status === 'paused' ? resumeJobs() : pauseJobs()} disabled={jobStatus.status === 'idle'}>
                  {jobStatus.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                </button>
                <button className="glass-button danger" style={{ flex: 1, display: 'flex', justifyContent: 'center' }} onClick={async () => {
                  if (window.confirm("Cancel all pending jobs?")) {
                    await axios.delete(`${API_BASE}/jobs`);
                  }
                }} disabled={jobStatus.status === 'idle'}>
                  <Square size={16} />
                </button>
              </div>
            </div>

            {selectedPaths.size > 0 && (
              <div className="glass-panel" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Batch Actions ({selectedPaths.size})</h3>
                  <button className="glass-button" onClick={() => setSelectedPaths(new Set())} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Clear</button>
                </div>
                
                <div className="input-group">
                  <label>Interval (seconds)</label>
                  <input type="number" min="1" value={interval} onChange={e => setIntervalVal(Number(e.target.value))} style={{ width: '100%', background: 'rgba(255,255,255,0.1)', border: 'none', padding: '0.5rem', borderRadius: '4px', color: 'white' }} />
                </div>
                
                <div className="input-group" style={{ marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={skipExisting} onChange={e => setSkipExisting(e.target.checked)} />
                    Skip if contact sheet exists
                  </label>
                </div>

                <button className="glass-button primary" style={{ width: '100%', marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }} onClick={startBatchJob} disabled={jobStatus.status === 'running'}>
                  <Play size={18} />
                  Start Batch ({selectedPaths.size} items)
                </button>

                <button className="glass-button danger" style={{ width: '100%', marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', border: '1px solid rgba(239, 68, 68, 0.5)', background: 'rgba(239, 68, 68, 0.15)' }} onClick={deleteSelectedVideos} disabled={jobStatus.status === 'running'}>
                  <Trash2 size={18} />
                  Delete {selectedPaths.size} Video{selectedPaths.size > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="main-content">
        <div className="top-bar">
          <h1 className="view-title">Gallery</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select 
              className="glass-input" 
              style={{ width: 'auto', padding: '0.5rem' }} 
              value={sortMode} 
              onChange={e => setSortMode(e.target.value as any)}
            >
              <option value="name">Sort by Name</option>
              <option value="date">Sort by Date</option>
            </select>
            <button className="glass-button" style={{ padding: '0.5rem' }} onClick={() => setSortAsc(!sortAsc)}>
              {sortAsc ? 'Asc' : 'Desc'}
            </button>
            <button className="glass-button" onClick={selectAll}>
              Select All
            </button>
          </div>
        </div>

        {/* Video map with optimized O(1) loopups inside */}
            <div className="video-grid">
              {[...files].filter(f => !f.is_dir)
                .sort((a, b) => {
                  let result = 0;
                  if (sortMode === 'name') {
                    result = a.name.localeCompare(b.name);
                  } else if (sortMode === 'date') {
                    result = (a.modified_time || 0) - (b.modified_time || 0);
                  }
                  return sortAsc ? result : -result;
                })
                .map(f => {
                const isProcessing = jobStatus.status === 'running' && jobStatus.current_video === f.name;
                const normalizedFilePath = normalizePath(f.path);
                const isClipping = runningSet.has(normalizedFilePath);
                const isClipQueued = queueSet.has(normalizedFilePath);
            
            return (
            <div id={`video-card-${encodeURIComponent(f.path).replace(/[^a-zA-Z0-9]/g, '_')}`} key={f.path} className={`video-card glass-panel ${selectedPaths.has(f.path) ? 'active' : ''} ${isProcessing ? 'processing' : ''}`}>
              <div 
                className="video-thumbnail" 
                onClick={() => { if (!isProcessing) openClip(f) }}
              >
                {f.has_contact_sheet ? (
                  <img src={`${API_BASE}/media?path=${encodeURIComponent(f.path.replace(/\.[^/.]+$/, "") + "_sheet.jpg")}`} alt="Contact Sheet" />
                ) : (
                  <Film size={48} opacity={0.5} />
                )}
                
                {!isProcessing && (
                  <div 
                    style={{ 
                      position: 'absolute', top: 10, left: 10, zIndex: 10, 
                      background: 'rgba(0,0,0,0.5)', padding: '0.4rem', borderRadius: '4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      toggleSelect(f.path); 
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={selectedPaths.has(f.path)}
                      onChange={() => {}}
                      style={{ transform: 'scale(1.3)', cursor: 'pointer', margin: 0 }}
                    />
                  </div>
                )}
              </div>
              <div className="video-info">
                <span className="video-title">{f.name}</span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="file-meta">
                    {f.has_contact_sheet ? (
                      <span className="badge success">Has Sheet</span>
                    ) : isProcessing ? (
                      <span className="badge" style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.4)' }}>Processing...</span>
                    ) : (
                      <span className="badge" style={{ background: 'rgba(255,255,255,0.1)' }}>No Sheet</span>
                    )}
                    
                    {(f.clip_count || 0) > 0 && (
                      <span className="badge" style={{ background: 'rgba(236, 72, 153, 0.15)', color: '#f472b6', border: '1px solid rgba(236, 72, 153, 0.3)' }}>
                        {f.clip_count} Clip{(f.clip_count || 0) > 1 ? 's' : ''}
                      </span>
                    )}
                    
                    {isClipping && (
                      <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                        Clipping...
                      </span>
                    )}
                    
                    {isClipQueued && !isClipping && (
                      <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#e5e7eb', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
                        Clip Queued
                      </span>
                    )}
                    
                    {f.tags && f.tags.length > 0 && f.tags.map((tag, idx) => {
                      const matches = f.ai_matches ? f.ai_matches[tag] : null;
                      return (
                        <span key={idx} className="badge" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', border: '1px solid rgba(168, 85, 247, 0.4)' }} title={matches ? matches.join(', ') : ''}>
                          {tag} {matches && matches.length > 0 && `(${matches.length})`}
                        </span>
                      );
                    })}
                  </span>
                  <span className="file-size">{f.size_bytes > 0 ? (f.size_bytes / (1024 * 1024)).toFixed(1) + ' MB' : ''}</span>
                  <div className="video-actions">
                    <button className="glass-button" disabled={isProcessing} onClick={() => openClip(f)} style={{ padding: '0.4rem' }}>
                      <Scissors size={14} />
                    </button>
                    <button className="glass-button danger" disabled={isProcessing} onClick={(e) => { e.stopPropagation(); deleteVideo(f.path); }} style={{ padding: '0.4rem' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>

      {showBatchModal && (
        <div className="modal-backdrop">
          <div className="modal glass-panel">
            <div className="modal-header">
              <h3 className="modal-title">Batch Thumbnail Job</h3>
              <button className="modal-close" onClick={() => setShowBatchModal(false)}><X size={20} /></button>
            </div>
            
            <p className="file-meta">You have selected {selectedPaths.size} items. The system will recursively generate contact sheets for any videos found.</p>

            <div className="form-group">
              <label className="form-label">Interval (seconds between frames)</label>
              <input 
                type="number" 
                className="glass-input" 
                value={interval} 
                onChange={e => setIntervalVal(Number(e.target.value))} 
              />
            </div>

            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={skipExisting} 
                  onChange={e => setSkipExisting(e.target.checked)} 
                />
                Skip existing contact sheets
              </label>
            </div>

            <button className="glass-button primary" style={{ width: '100%', marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }} onClick={startBatchJob} disabled={jobStatus.status === 'running'}>
              <Play size={18} />
              Start Batch ({selectedPaths.size} items)
            </button>

            <button 
              className="glass-button danger" 
              style={{ 
                width: '100%', marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem',
                border: '1px solid rgba(239, 68, 68, 0.5)', background: 'rgba(239, 68, 68, 0.15)'
              }}
              onClick={deleteSelectedVideos}
              disabled={jobStatus.status === 'running'}
            >
              <Trash2 size={18} />
              Delete {selectedPaths.size} Video{selectedPaths.size > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Global Job Tracker Panel */}
      {jobStatus.queue_length > 0 && (
        <div className="job-tracker glass-panel" style={{ 
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000, 
          display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', 
          background: 'rgba(15,15,15,0.95)', border: '1px solid rgba(255,255,255,0.1)' 
        }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff' }}>Global Job Queue</h4>
            <div className="file-meta" style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>
              {jobStatus.status === 'paused' ? 'Paused: ' : 'Processing: '} 
              <span style={{ color: '#aaa' }}>{jobStatus.current_video || 'Preparing...'}</span> 
              <span style={{ opacity: 0.7, marginLeft: '0.5rem' }}>({jobStatus.queue_length} left)</span>
            </div>
          </div>
          <div>
            {jobStatus.status === 'running' ? (
              <button className="glass-button danger" onClick={pauseJobs} title="Safe Pause">
                <Pause size={18} />
              </button>
            ) : (
              <button className="glass-button primary" onClick={resumeJobs} title="Resume">
                <Play size={18} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
      {clippingVideo && (
        <ClippingTool video={clippingVideo} onClose={closeClip} />
      )}
    </>
  );
}

// --- Clipping Tool Component --- //

function ClippingTool({ video, onClose }: { video: FileItem, onClose: () => void }) {
  const [start, setStart] = useState('00:00:00');
  const [end, setEnd] = useState('00:00:10');
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Force browser to the absolute top immediately when this mounts
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);
  
  const [clips, setClips] = useState<{name: string, path: string}[]>([]);
  const [pendingClips, setPendingClips] = useState<any[]>([]);
  const [buttonCooldown, setButtonCooldown] = useState(false);

  const loadClips = async () => {
    try {
      const res = await axios.get(`${API_BASE}/clips`, { params: { video_path: video.path } });
      setClips(res.data);
      
      const jobsRes = await axios.get(`${API_BASE}/clip/jobs`, { params: { video_path: video.path } });
      if (jobsRes.data && typeof jobsRes.data === 'object' && !Array.isArray(jobsRes.data)) {
        setPendingClips([...(jobsRes.data.running || []), ...(jobsRes.data.queue || [])]);
      } else {
        setPendingClips(jobsRes.data || []);
      }
    } catch (err) {
      console.error("Error loading clips", err);
    }
  };

  useEffect(() => {
    let intervalId: any;
    if (pendingClips.length > 0) {
      intervalId = setInterval(() => {
        loadClips();
      }, 1500);
    }
    return () => clearInterval(intervalId);
  }, [pendingClips.length]);

  useEffect(() => {
    loadClips();
  }, [video.path]);

  // Force the browser to release the file lock when the modal closes
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, []);

  // Playback Controls
  const [playbackRate, setPlaybackRate] = useState(1);
  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const stepSeconds = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  };

  const stepFrames = (frames: number) => {
    // Assume 30fps 
    if (videoRef.current) {
      videoRef.current.currentTime += frames / 30;
    }
  };

  // Pan and Zoom State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastPan = useRef({ x: 0, y: 0 });
  const wheelContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = wheelContainerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 0.1;
      setScale(prev => {
        const newScale = e.deltaY < 0 ? prev * (1 + zoomFactor) : prev * (1 - zoomFactor);
        return Math.min(Math.max(1, newScale), 5);
      });
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    lastPan.current = { x: pan.x, y: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      isDragging.current = true;
    }
    if (isDragging.current) {
      setPan({ x: lastPan.current.x + dx, y: lastPan.current.y + dy });
    }
  };

  const handleMouseUp = () => { setTimeout(() => isDragging.current = false, 0); };
  const handleMouseLeave = () => { isDragging.current = false; };
  const resetZoom = () => { setScale(1); setPan({ x: 0, y: 0 }); };

  const formatTime = (seconds: number) => {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const vid = videoRef.current;
    if (!vid || !vid.duration) return;

    const elWidth = img.offsetWidth;
    const elHeight = img.offsetHeight;
    
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = elWidth / elHeight;
    
    let renderedWidth, renderedHeight, boxOffsetX = 0, boxOffsetY = 0;
    
    // Calculate the actual rendered dimensions of the image inside the object-fit: contain box
    if (imgAspect > boxAspect) {
      renderedWidth = elWidth;
      renderedHeight = elWidth / imgAspect;
      boxOffsetY = (elHeight - renderedHeight) / 2;
    } else {
      renderedHeight = elHeight;
      renderedWidth = elHeight * imgAspect;
      boxOffsetX = (elWidth - renderedWidth) / 2;
    }
    
    // offsetX/Y are in the unscaled layout space, so we just subtract the letterbox offset
    const clickX = e.nativeEvent.offsetX - boxOffsetX;
    const clickY = e.nativeEvent.offsetY - boxOffsetY;
    
    if (clickX < 0 || clickX > renderedWidth || clickY < 0 || clickY > renderedHeight) return;
    
    const scaleX = img.naturalWidth / renderedWidth;
    const scaleY = img.naturalHeight / renderedHeight;
    
    const x = clickX * scaleX;
    const y = clickY * scaleY;
    
    const padding = 10;
    const header_h = 60;
    const thumb_w = 320;
    
    if (y < header_h) return; // Clicked in header
    
    const cols = Math.max(1, Math.floor(img.naturalWidth / (thumb_w + padding)));
    const aspect = (vid.videoWidth / vid.videoHeight) || (16/9);
    const thumb_h = Math.floor(thumb_w / aspect);
    
    const col = Math.floor((x - padding) / (thumb_w + padding));
    const row = Math.floor((y - header_h - padding) / (thumb_h + padding));
    
    if (col < 0 || col >= cols || row < 0) return;
    
    const index = row * cols + col;
    
    // Estimate interval
    const imgRows = Math.max(1, Math.round((img.naturalHeight - header_h - padding) / (thumb_h + padding)));
    const gridCapacity = cols * imgRows;
    
    const savedInterval = Number(localStorage.getItem('batchInterval')) || 60;
    const commonIntervals = [savedInterval, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 600, 900, 1200, 1800];
    
    let interval = savedInterval;
    let actualFrames = gridCapacity;
    let foundMatch = false;

    for (let inv of commonIntervals) {
      let testFrames = 0;
      let testC = 1;
      let testR = 1;

      const baseNum = Math.floor(vid.duration / inv);
      if (baseNum < 3) {
        testFrames = 3;
        testC = Math.ceil(Math.sqrt(testFrames));
        testR = Math.ceil(testFrames / testC);
        if (testC === cols && testR === imgRows) {
          interval = vid.duration / 4;
          actualFrames = 3;
          foundMatch = true;
          break;
        }
      } else {
        for (let i = 1; i <= baseNum; i++) {
          if (i * inv < vid.duration) testFrames++;
        }
        testC = Math.max(1, Math.ceil(Math.sqrt(testFrames || 1)));
        testR = Math.ceil((testFrames || 1) / testC);
        if (testC === cols && testR === imgRows) {
          interval = inv;
          actualFrames = testFrames;
          foundMatch = true;
          break;
        }
      }
    }

    if (!foundMatch) {
      // Fallback: grid logic or completely unknown interval
      interval = vid.duration / (gridCapacity + 1); 
      actualFrames = gridCapacity; 
    }
    
    if (index >= actualFrames) return;
    
    const clickTime = (index + 1) * interval;
    if (clickTime <= vid.duration) {
      vid.currentTime = clickTime;
      vid.play().catch(() => {}); // Auto-play from that point
    }
  };

  const extractClip = async () => {
    setButtonCooldown(true);
    setTimeout(() => setButtonCooldown(false), 1000);
    
    try {
      await axios.post(`${API_BASE}/clip`, {
        video_path: video.path,
        start_time: start,
        end_time: end
      });
      loadClips();
    } catch (err) {
      console.error(err);
      alert("Failed to queue clip extraction.");
    }
  };

  return (
    <div className="app-container" style={{ 
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999, 
      backgroundColor: 'var(--bg-color)' 
    }}>
      <div className="clipping-container" style={{ width: '100%', height: '100%', padding: '2rem' }}>
        <div className="clipping-main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Extracting from: {video.name}</h2>
            <button className="glass-button" onClick={onClose}><X size={18} /> Back</button>
          </div>

          <div className="video-player-container">
            <video ref={videoRef} controls muted src={`${API_BASE}/media?path=${encodeURIComponent(video.path)}`}></video>
          </div>

          <div className="glass-panel controls-panel" style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.85rem', opacity: 0.8, marginRight: '0.5rem' }}>Speed:</label>
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => (
                  <button 
                    key={rate}
                    className={`glass-button ${playbackRate === rate ? 'primary' : ''}`} 
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', backgroundColor: playbackRate === rate ? 'var(--primary-color)' : undefined }} 
                    onClick={() => handleRateChange(rate)}
                  >
                    {rate === 1 ? '1x' : `${rate}x`}
                  </button>
                ))}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.85rem', opacity: 0.8, marginRight: '0.5rem' }}>Jump (sec):</label>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(-60)}>-60</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(-30)}>-30</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(-15)}>-15</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(-5)}>-5</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(5)}>+5</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(15)}>+15</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(30)}>+30</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepSeconds(60)}>+60</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.85rem', opacity: 0.8, marginRight: '0.5rem' }}>Jump (frames):</label>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(-50)}>-50</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(-20)}>-20</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(-5)}>-5</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(5)}>+5</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(20)}>+20</button>
                <button className="glass-button" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => stepFrames(50)}>+50</button>
              </div>
            </div>
          </div>

          <div className="glass-panel controls-panel">
            <div className="form-group">
              <label className="form-label">Start Time (HH:MM:SS)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" className="glass-input" value={start} onChange={e => setStart(e.target.value)} />
                <button className="glass-button" onClick={() => setStart(formatTime(videoRef.current?.currentTime || 0))}>Set</button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">End Time (HH:MM:SS)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" className="glass-input" value={end} onChange={e => setEnd(e.target.value)} />
                <button className="glass-button" onClick={() => setEnd(formatTime(videoRef.current?.currentTime || 0))}>Set</button>
              </div>
            </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="glass-button primary" onClick={extractClip} disabled={buttonCooldown}>
                {buttonCooldown ? 'Added to Queue...' : 'Extract Clip'}
              </button>
            </div>
          </div>

          <div className="glass-panel controls-panel" style={{ marginTop: '1rem', flexGrow: 1, overflowY: 'auto' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Saved Clips</h3>
            {clips.length === 0 && pendingClips.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: '0.9rem' }}>No clips extracted yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {clips.filter(clip => !pendingClips.some((job: any) => job.name === clip.name)).map(clip => (
                  <div key={clip.path} className="file-item glass-panel" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem' }}>
                    <div style={{ overflow: 'hidden', flexGrow: 1, marginRight: '1rem' }}>
                      <span className="file-name" style={{ fontSize: '0.85rem' }}>{clip.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="glass-button" style={{ padding: '0.3rem' }} title="Play in Default Player" onClick={() => {
                        axios.post(`${API_BASE}/open-file`, { path: clip.path }).catch(() => alert("Failed to open file"));
                      }}>
                        <Play size={14} />
                      </button>
                      <button className="glass-button danger" style={{ padding: '0.3rem' }} title="Delete Clip" onClick={() => {
                        if(confirm('Delete this clip?')) {
                          axios.delete(`${API_BASE}/files`, { params: { path: clip.path } }).then(() => loadClips());
                        }
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {pendingClips.map((job: any) => (
                  <div key={job.name} className="file-item glass-panel" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', opacity: 0.7 }}>
                    <div style={{ overflow: 'hidden', flexGrow: 1, marginRight: '1rem' }}>
                      <span className="file-name" style={{ fontSize: '0.85rem' }}>{job.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', marginRight: '0.5rem', opacity: 0.8 }}>Processing...</span>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="clipping-sidebar glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ padding: '1rem 1rem 0', fontSize: '1.1rem' }}>Contact Sheet</h3>
          <p className="file-meta" style={{ padding: '0 1rem' }}>Scroll to zoom, drag to pan. Click on a thumbnail to seek the video to that timestamp.</p>
          <div className="contact-sheet-viewer" style={{ overflow: 'hidden', padding: 0, position: 'relative', flexGrow: 1 }}>
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: '0.5rem' }}>
              <button className="glass-button" style={{ padding: '0.2rem 0.6rem' }} onClick={() => setScale(s => Math.min(s * 1.2, 5))}>+</button>
              <button className="glass-button" style={{ padding: '0.2rem 0.6rem' }} onClick={() => setScale(s => Math.max(s / 1.2, 1))}>-</button>
              <button className="glass-button" style={{ padding: '0.2rem 0.6rem' }} onClick={resetZoom}>Reset</button>
            </div>
            
            {video.has_contact_sheet ? (
              <div 
                ref={wheelContainerRef}
                style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: isDragging.current ? 'grabbing' : 'grab'
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                <img 
                  src={`${API_BASE}/media?path=${encodeURIComponent(video.path.replace(/\.[^/.]+$/, "") + "_sheet.jpg")}`} 
                  alt="Contact Sheet" 
                  onClick={(e) => {
                    if (isDragging.current) return;
                    handleImageClick(e);
                  }}
                  draggable={false}
                  style={{ 
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transformOrigin: 'center center',
                    transition: isDragging.current ? 'none' : 'transform 0.1s ease',
                    maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'
                  }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                No contact sheet generated.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
