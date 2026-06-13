import argparse
import math
import os
import subprocess
import sys
import tempfile
import concurrent.futures
from PIL import Image, ImageDraw, ImageFont
from ai_filter import run_vision_filter, add_tag_to_metadata

def get_video_info(video_path):
    """Uses ffprobe to extract video metadata."""
    cmd = [
        "ffprobe", "-v", "error", 
        "-select_streams", "v:0", 
        "-show_entries", "stream=width,height:format=duration,size", 
        "-of", "default=noprint_wrappers=1",
        video_path
    ]
    try:
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, creationflags=creation_flags)
        info = {}
        for line in result.stdout.strip().split('\n'):
            if '=' in line:
                key, val = line.split('=')
                info[key.strip()] = val.strip()
        
        duration = float(info.get('duration', 0))
        width = int(info.get('width', 0))
        height = int(info.get('height', 0))
        size_bytes = int(info.get('size', 0))
        
        return duration, width, height, size_bytes
    except Exception as e:
        print(f"ffprobe error: {e}")
        return None, None, None, None

def format_duration(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

def format_size(size_bytes):
    if size_bytes == 0:
        return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"

import asyncio

async def extract_single_frame(video_path, ts, out_path, semaphore):
    async with semaphore:
        cmd = [
            "ffmpeg", "-y", "-hwaccel", "auto", "-ss", str(ts), "-i", str(video_path),
            "-frames:v", "1", "-q:v", "2", str(out_path)
        ]
        try:
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                creationflags=creation_flags
            )
            await process.wait()
            if process.returncode == 0:
                return out_path
        except Exception:
            pass
        return None

async def extract_frames(video_path, timestamps, interval_val, temp_dir):
    """Extracts frames using fast-seeking concurrency."""
    extracted_files = []
    semaphore = asyncio.Semaphore(10)  # Max 10 concurrent ffmpeg processes
    
    tasks = []
    for i, ts in enumerate(timestamps):
        out_path = os.path.join(temp_dir, f"frame_{i:04d}.jpg")
        tasks.append(extract_single_frame(video_path, ts, out_path, semaphore))
        
    results = await asyncio.gather(*tasks)
    
    for i, (out_path, ts) in enumerate(zip(results, timestamps)):
        if out_path and os.path.exists(out_path):
            extracted_files.append((out_path, format_duration(ts)))
            
    return extracted_files

def create_contact_sheet(video_path, info, frames, out_path, cols, rows):
    """Assembles the frames into a grid using Pillow."""
    duration, width, height, size_bytes = info
    
    images = []
    for f_path, ts in frames:
        try:
            img = Image.open(f_path)
            img.load()
            images.append((img, ts))
        except Exception:
            pass

    if not images:
        print("No frames extracted.")
        return

    # Dimensions
    thumb_w = 320
    aspect = width / height if height > 0 else 16/9
    thumb_h = int(thumb_w / aspect)
    
    padding = 10
    header_h = 60
    
    sheet_w = cols * thumb_w + (cols + 1) * padding
    sheet_h = rows * thumb_h + (rows + 1) * padding + header_h
    
    sheet = Image.new('RGB', (sheet_w, sheet_h), color=(25, 25, 25))
    draw = ImageDraw.Draw(sheet)
    
    # Try to load a nicer font, fallback to default if not found
    try:
        font_large = ImageFont.truetype("arial.ttf", 24)
        font_small = ImageFont.truetype("arial.ttf", 16)
        font_tiny = ImageFont.truetype("arial.ttf", 14)
    except IOError:
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()
        font_tiny = ImageFont.load_default()
        
    filename = os.path.basename(video_path)
    dur_str = format_duration(duration)
    res_str = f"{width}x{height}"
    size_str = format_size(size_bytes)
    
    # Draw header text
    draw.text((padding, padding), filename, font=font_large, fill=(255, 255, 255))
    meta_text = f"Duration: {dur_str}  |  Res: {res_str}  |  Size: {size_str}"
    
    # Top right alignment
    try:
        text_w = draw.textlength(meta_text, font=font_small)
    except AttributeError:
        # Fallback for older Pillow versions
        text_w = font_small.getsize(meta_text)[0]
        
    draw.text((sheet_w - padding - text_w, padding + 10), meta_text, font=font_small, fill=(200, 200, 200))
    
    # Draw frames
    for i, (img, ts) in enumerate(images):
        img = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        
        col = i % cols
        row = i // cols
        
        x = padding + col * (thumb_w + padding)
        y = header_h + padding + row * (thumb_h + padding)
        
        sheet.paste(img, (x, y))
        
        # Draw timestamp box in bottom right of each frame
        ts_x = x + thumb_w - 55
        ts_y = y + thumb_h - 22
        draw.rectangle([ts_x, ts_y, x + thumb_w - 5, y + thumb_h - 5], fill=(0, 0, 0, 180))
        draw.text((ts_x + 5, ts_y + 3), ts, font=font_tiny, fill=(255, 255, 255))
        
    sheet.save(out_path, quality=95)


async def process_video_file(video_path, output_dir=None, skip_existing=False, grid=None, interval=None, run_ai_filter=False, ai_api_url=None, ai_api_key=None, ai_model=None, ai_prompt=None):
    if not os.path.isfile(video_path):
        return

    filename = os.path.basename(video_path)
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(video_path))
    
    os.makedirs(output_dir, exist_ok=True)
    out_filename = os.path.splitext(filename)[0] + "_sheet.jpg"
    out_path = os.path.join(output_dir, out_filename)
    
    if skip_existing and os.path.exists(out_path):
        print(f"Skipping '{filename}' (contact sheet already exists).")
        return
        
    print(f"Processing '{filename}'...")
    
    try:
        duration, width, height, size_bytes = get_video_info(video_path)
        if duration is None or duration <= 0:
            print(f"  Skipping: Could not read duration (possibly corrupted or unsupported).")
            return
            
        # Logic: Determine timestamps and dimensions based on arguments
        if grid:
            try:
                cols, rows = map(int, grid.split('x'))
            except ValueError:
                print("  Invalid grid format. Please use NxM (e.g., 3x3). Skipping.")
                return
            num_frames = cols * rows
            offset = duration / (num_frames + 1)
            timestamps = [offset * i for i in range(1, num_frames + 1)]
        else:
            interval_val = interval if interval else 60
            num_frames = int(duration / interval_val)
            
            # Fallback for very short videos
            if num_frames < 3:
                print(f"  Video too short for {interval_val}s interval. Falling back to 3 even frames.")
                num_frames = 3
                interval_val = duration / (num_frames + 1)
                timestamps = [interval_val * i for i in range(1, num_frames + 1)]
            else:
                timestamps = [interval_val * i for i in range(1, num_frames + 1) if interval_val * i < duration]
            
            # Dynamic grid calculation to keep it roughly square
            cols = math.ceil(math.sqrt(len(timestamps)))
            if cols == 0: cols = 1
            rows = math.ceil(len(timestamps) / cols)
            
        print(f"  Extracting {len(timestamps)} frames (Grid: {cols}x{rows})...")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            interval_val_for_fps = duration / (num_frames + 1) if grid else interval_val
            frames = await extract_frames(video_path, timestamps, interval_val_for_fps, temp_dir)
            
            if not frames:
                print("  Failed to extract any frames. Skipping.")
                return
                
            info = (duration, width, height, size_bytes)
            create_contact_sheet(video_path, info, frames, out_path, cols, rows)
            
            print(f"  Saved contact sheet: {out_path}")
            
            if run_ai_filter and ai_api_url and ai_api_key and ai_model and ai_prompt:
                print(f"  Running AI Filter for '{ai_prompt}'...")
                timestamps = run_vision_filter(out_path, ai_prompt, ai_api_url, ai_api_key, ai_model)
                if timestamps:
                    print(f"  => Match found at {timestamps}! Tagging video with '{ai_prompt}'.")
                    add_tag_to_metadata(video_path, ai_prompt, timestamps)
                else:
                    print("  => No match.")
            
    except Exception as e:
        print(f"  ERROR processing {filename}: {e}")

def main():
    parser = argparse.ArgumentParser(description="Generate timestamped video contact sheets.")
    parser.add_argument("--source", type=str, default=".", help="Directory containing videos.")
    parser.add_argument("--output", type=str, default="thumbnails_output", help="Output directory.")
    
    # Mutually exclusive group for interval vs grid
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--interval", type=int, help="Extract a frame every N seconds.")
    group.add_argument("--grid", type=str, help="Specify a fixed grid e.g., 3x3, 4x4.")
    
    parser.add_argument("--file", type=str, help="Process a single video file directly.")
    parser.add_argument("--skip-existing", action="store_true", help="Skip videos that already have a contact sheet in the output directory.")
    
    args = parser.parse_args()
    
    if args.file:
        files_to_process = [os.path.abspath(args.file)]
        output_dir = os.path.abspath(args.output) if args.output != "thumbnails_output" else os.path.dirname(files_to_process[0])
    else:
        source_dir = os.path.abspath(args.source)
        output_dir = os.path.abspath(args.output)
        valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".wmv"}
        files_to_process = []
        if os.path.isdir(source_dir):
            for f in os.listdir(source_dir):
                if os.path.splitext(f)[1].lower() in valid_exts:
                    files_to_process.append(os.path.join(source_dir, f))
                    
    # Default to 60s interval if nothing is provided
    if not args.interval and not args.grid:
        args.interval = 60
        
    for video_path in files_to_process:
        asyncio.run(process_video_file(video_path, output_dir=output_dir, skip_existing=args.skip_existing, grid=args.grid, interval=args.interval))

if __name__ == "__main__":
    main()
