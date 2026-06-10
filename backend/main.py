from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Dict
from fastapi import BackgroundTasks, HTTPException, Request, status
from fastapi.responses import FileResponse, StreamingResponse
import subprocess
import mimetypes
import time
import tkinter as tk
from tkinter import filedialog
from generate_thumbnails import process_video_file

app = FastAPI(title="GridClipper API")

# Allow CORS for local React development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FileItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    has_contact_sheet: bool = False
    size_bytes: int = 0
    modified_time: Optional[float] = None
    clip_count: int = 0
    tags: List[str] = []
    ai_matches: Optional[Dict[str, List[str]]] = None


@app.get("/api/files", response_model=List[FileItem])
def list_files(dir_path: str = "."):
    target_dir = Path(dir_path).resolve()
    if not target_dir.exists() or not target_dir.is_dir():
        return []

    items = []
    valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".wmv"}

    try:
        clip_counts = {}
        clips_dir = target_dir / "clips"
        if clips_dir.exists() and clips_dir.is_dir():
            for c_entry in os.scandir(clips_dir):
                if c_entry.is_file() and "_clip_" in c_entry.name:
                    base_name = c_entry.name.rsplit("_clip_", 1)[0]
                    clip_counts[base_name] = clip_counts.get(base_name, 0) + 1

        entries = list(os.scandir(target_dir))
        file_names = {e.name for e in entries if e.is_file()}

        for entry in entries:
            if entry.is_dir():
                # Skip some hidden or cache dirs
                if entry.name.startswith(".") or entry.name == "__pycache__":
                    continue
                items.append(
                    FileItem(
                        name=entry.name,
                        path=str(Path(entry.path).resolve()),
                        is_dir=True,
                    )
                )
            elif entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in valid_exts:
                    base_name = os.path.splitext(entry.name)[0]
                    has_sheet = (base_name + "_sheet.jpg") in file_names
                    clip_count = clip_counts.get(base_name, 0)

                    tags = []
                    ai_matches = {}
                    if (base_name + "_metadata.json") in file_names:
                        metadata_path = target_dir / (base_name + "_metadata.json")
                        try:
                            import json

                            with open(metadata_path, "r", encoding="utf-8") as f:
                                meta = json.load(f)
                                tags = meta.get("tags", [])
                                ai_matches = meta.get("ai_matches", {})
                        except Exception as meta_e:
                            print(f"Error reading metadata for {base_name}: {meta_e}")

                    stat = entry.stat()
                    items.append(
                        FileItem(
                            name=entry.name,
                            path=str(Path(entry.path).resolve()),
                            is_dir=False,
                            has_contact_sheet=has_sheet,
                            size_bytes=stat.st_size,
                            modified_time=stat.st_mtime,
                            clip_count=clip_count,
                            tags=tags,
                            ai_matches=ai_matches,
                        )
                    )
    except Exception as e:
        print(f"Error scanning directory {target_dir}: {e}")

    # Sort directories first, then alphabetically
    items.sort(key=lambda x: (not x.is_dir, x.name.lower()))
    return items


@app.get("/api/select-folder")
def select_folder():
    # Hide the root tkinter window
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)  # Bring to front

    folder_path = filedialog.askdirectory(title="Select a directory to navigate to")
    root.destroy()

    if folder_path:
        return {"path": folder_path}
    return {"path": ""}


def send_bytes_range_requests(file_path: str, start: int, end: int, chunk_size: int = 1_000_000):
    with open(file_path, "rb") as f:
        f.seek(start)
        while (pos := f.tell()) <= end:
            read_size = min(chunk_size, end + 1 - pos)
            chunk = f.read(read_size)
            if not chunk:
                break
            yield chunk


@app.get("/api/media")
def get_media(request: Request, path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    if range_header:
        range_str = range_header.replace("bytes=", "").split("-")
        start = int(range_str[0]) if range_str[0] else 0
        end = int(range_str[1]) if len(range_str) > 1 and range_str[1] else file_size - 1

        if start >= file_size:
            raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)

        content_type, _ = mimetypes.guess_type(path)
        content_type = content_type or "application/octet-stream"

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
            "Content-Type": content_type,
        }

        return StreamingResponse(
            send_bytes_range_requests(path, start, end),
            status_code=206,
            headers=headers,
            media_type=content_type,
        )
    else:
        return FileResponse(path)


@app.delete("/api/files")
def delete_file(path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    def try_remove(p):
        for _ in range(10):
            try:
                os.remove(p)
                return True
            except PermissionError:
                time.sleep(0.5)
            except FileNotFoundError:
                return True
        return False

    try:
        if not try_remove(path):
            raise Exception("File is locked by another process and could not be deleted.")

        sheet_path = os.path.splitext(path)[0] + "_sheet.jpg"
        if os.path.exists(sheet_path):
            try_remove(sheet_path)

        return {"status": "deleted", "path": path}
    except Exception as e:
        print(f"Error deleting file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class JobManager:
    def __init__(self):
        self.queue = []
        self.status = "idle"  # idle, running, paused
        self.current_video = None
        self.is_running = False

    def get_status(self):
        return {
            "status": self.status,
            "queue_length": len(self.queue),
            "current_video": self.current_video,
        }


job_manager = JobManager()


class BatchJobRequest(BaseModel):
    source_dirs: List[str]
    interval: Optional[int] = None
    grid: Optional[str] = None
    skip_existing: bool = True
    run_ai_filter: bool = False
    ai_api_url: str = "http://localhost:1234/v1"
    ai_api_key: str = "lm-studio"
    ai_model: str = "gemma-4-e4b-uncensored-hauhaucs-aggressive"
    ai_prompt: str = ""


import asyncio


async def process_queue():
    if job_manager.is_running:
        return
    job_manager.is_running = True
    job_manager.status = "running"

    while job_manager.queue:
        if job_manager.status == "paused":
            break

        video_path, req_args = job_manager.queue[0]
        job_manager.current_video = os.path.basename(video_path)

        if not os.path.exists(video_path):
            print(f"Skipping {video_path} because it was deleted or moved.")
            if job_manager.queue:
                job_manager.queue.pop(0)
            continue

        try:
            # We await the async process_video_file
            await process_video_file(
                video_path,
                skip_existing=req_args.get("skip_existing"),
                grid=req_args.get("grid"),
                interval=req_args.get("interval"),
                run_ai_filter=req_args.get("run_ai_filter"),
                ai_api_url=req_args.get("ai_api_url"),
                ai_api_key=req_args.get("ai_api_key"),
                ai_model=req_args.get("ai_model"),
                ai_prompt=req_args.get("ai_prompt"),
            )
        except Exception as e:
            print(f"Batch job failed for {video_path}: {e}")

        if job_manager.queue:
            job_manager.queue.pop(0)

    if not job_manager.queue:
        job_manager.status = "idle"
        job_manager.current_video = None

    job_manager.is_running = False


@app.post("/api/batch-thumbnail")
def start_batch_thumbnail(req: BatchJobRequest, background_tasks: BackgroundTasks):
    from pathlib import Path

    valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".wmv"}
    added_count = 0

    req_args = {
        "skip_existing": req.skip_existing,
        "grid": req.grid,
        "interval": req.interval,
        "run_ai_filter": req.run_ai_filter,
        "ai_api_url": req.ai_api_url,
        "ai_api_key": req.ai_api_key,
        "ai_model": req.ai_model,
        "ai_prompt": req.ai_prompt,
    }

    for s_dir in req.source_dirs:
        target_dir = Path(s_dir).resolve()
        if target_dir.is_dir():
            for entry in os.scandir(target_dir):
                if entry.is_file() and os.path.splitext(entry.name)[1].lower() in valid_exts:
                    if req.skip_existing:
                        out_path = os.path.splitext(entry.path)[0] + "_sheet.jpg"
                        if os.path.exists(out_path):
                            continue
                    job_manager.queue.append((str(Path(entry.path).resolve()), req_args))
                    added_count += 1
        elif target_dir.is_file() and target_dir.suffix.lower() in valid_exts:
            if req.skip_existing:
                out_path = os.path.splitext(str(target_dir))[0] + "_sheet.jpg"
                if os.path.exists(out_path):
                    continue
            job_manager.queue.append((str(target_dir), req_args))
            added_count += 1

    if job_manager.status != "paused":
        background_tasks.add_task(process_queue)

    return {"status": "added", "message": f"Added {added_count} videos to queue"}


@app.get("/api/jobs/status")
def get_job_status():
    return job_manager.get_status()


@app.post("/api/jobs/pause")
def pause_jobs():
    if job_manager.status == "running":
        job_manager.status = "paused"
    return job_manager.get_status()


@app.post("/api/jobs/resume")
def resume_jobs(background_tasks: BackgroundTasks):
    if job_manager.status == "paused" and job_manager.queue:
        job_manager.status = "running"
        background_tasks.add_task(process_queue)
    return job_manager.get_status()


@app.delete("/api/jobs")
def clear_jobs():
    job_manager.queue.clear()
    if job_manager.status != "running":
        job_manager.status = "idle"
        job_manager.current_video = None
    return {"status": "cleared", "queue_length": 0}


class ClipJobManager:
    def __init__(self):
        self.queue = []
        self.running = []
        self.is_running = False

    def get_jobs(self, video_path: str = None):
        if video_path:
            vp = str(Path(video_path).resolve())
            r = [j for j in self.running if str(Path(j["video_path"]).resolve()) == vp]
            q = [j for j in self.queue if str(Path(j["video_path"]).resolve()) == vp]
            return {"running": r, "queue": q}
        return {"running": self.running, "queue": self.queue}


clip_manager = ClipJobManager()


async def process_clip_queue():
    if clip_manager.is_running:
        return
    clip_manager.is_running = True

    while clip_manager.queue:
        job = clip_manager.queue.pop(0)
        clip_manager.running.append(job)

        video = Path(job["video_path"])
        out_file = job["out_file"]

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-ss",
            job["start_time"],
            "-to",
            job["end_time"],
            "-c",
            "copy",
            str(out_file),
        ]

        try:
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                creationflags=creation_flags,
            )
            await process.wait()
            if process.returncode != 0:
                print(f"Batch clip failed for {out_file} with code {process.returncode}")
        except Exception as e:
            print(f"Batch clip exception for {out_file}: {e}")

        clip_manager.running.remove(job)

    clip_manager.is_running = False


class ClipRequest(BaseModel):
    video_path: str
    start_time: str
    end_time: str
    output_dir: Optional[str] = None


@app.get("/api/clip/jobs")
def get_clip_jobs(video_path: str = None):
    return clip_manager.get_jobs(video_path)


@app.post("/api/clip")
def create_clip(req: ClipRequest, background_tasks: BackgroundTasks):
    video = Path(req.video_path)
    if not video.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    out_dir = Path(req.output_dir) if req.output_dir else video.parent / "clips"
    out_dir.mkdir(exist_ok=True)

    out_file = (
        out_dir / f"{video.stem}_clip_{req.start_time.replace(':', '')}-{req.end_time.replace(':', '')}{video.suffix}"
    )

    job = {
        "video_path": req.video_path,
        "start_time": req.start_time,
        "end_time": req.end_time,
        "out_file": str(out_file),
        "name": out_file.name,
    }

    clip_manager.queue.append(job)
    background_tasks.add_task(process_clip_queue)

    return {"status": "queued", "job": job}


@app.get("/api/clips")
def list_clips(video_path: str):
    video = Path(video_path)
    clips_dir = video.parent / "clips"
    if not clips_dir.exists():
        return []

    clips = []
    prefix = f"{video.stem}_clip_"
    try:
        for entry in os.scandir(clips_dir):
            if entry.is_file() and entry.name.startswith(prefix):
                clips.append({"name": entry.name, "path": str(Path(entry.path).resolve())})
    except Exception as e:
        print(f"Error reading clips directory: {e}")

    # Sort by creation time (implicitly by name since name has timestamps)
    clips.sort(key=lambda x: x["name"])
    return clips


@app.post("/api/open-file")
def open_file_external(req: dict):
    path = req.get("path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        if os.name == "nt":
            os.startfile(path)
        else:
            import subprocess

            subprocess.run(["xdg-open", path])
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AIFilterJobManager:
    def __init__(self):
        self.queue = []
        self.running = []
        self.is_running = False

    def get_jobs(self, video_path: str = None):
        all_jobs = self.running + self.queue
        if video_path:
            vp = str(Path(video_path).resolve())
            all_jobs = [j for j in all_jobs if str(Path(j["video_path"]).resolve()) == vp]
        return all_jobs


ai_filter_manager = AIFilterJobManager()


def process_ai_filter_queue():
    if ai_filter_manager.is_running:
        return
    ai_filter_manager.is_running = True

    while ai_filter_manager.queue:
        job = ai_filter_manager.queue.pop(0)
        ai_filter_manager.running.append(job)

        try:
            from ai_filter import run_vision_filter, add_tag_to_metadata

            video_path = job["video_path"]
            sheet_path = job["sheet_path"]

            timestamps = run_vision_filter(
                sheet_path,
                job["ai_prompt"],
                job["ai_api_url"],
                job["ai_api_key"],
                job["ai_model"],
            )

            if timestamps:
                add_tag_to_metadata(video_path, job["ai_prompt"], timestamps)

        except Exception as e:
            print(f"AI Filter batch failed for {job['video_path']}: {e}")

        ai_filter_manager.running.remove(job)

    ai_filter_manager.is_running = False


class AIFilterRequest(BaseModel):
    source_paths: List[str]
    ai_api_url: str
    ai_api_key: str
    ai_model: str
    ai_prompt: str


@app.post("/api/ai-filter")
def start_ai_filter_batch(req: AIFilterRequest, background_tasks: BackgroundTasks):
    from pathlib import Path

    valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".wmv"}
    added_count = 0

    for s_path in req.source_paths:
        target_path = Path(s_path).resolve()

        if target_path.is_file() and target_path.suffix.lower() in valid_exts:
            out_path = os.path.splitext(target_path)[0] + "_sheet.jpg"
            if os.path.exists(out_path):
                job = {
                    "video_path": str(target_path),
                    "sheet_path": out_path,
                    "ai_api_url": req.ai_api_url,
                    "ai_api_key": req.ai_api_key,
                    "ai_model": req.ai_model,
                    "ai_prompt": req.ai_prompt,
                }
                ai_filter_manager.queue.append(job)
                added_count += 1

    background_tasks.add_task(process_ai_filter_queue)
    return {
        "status": "added",
        "message": f"Added {added_count} contact sheets to AI Filter queue",
    }


@app.get("/api/ai-filter/jobs")
def get_ai_filter_jobs(video_path: str = None):
    return ai_filter_manager.get_jobs(video_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
