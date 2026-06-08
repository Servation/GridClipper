import base64
import json
import os
from openai import OpenAI

def encode_image(image_path):
    """Encodes an image to Base64 format."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def run_vision_filter(image_path: str, prompt: str, api_url: str, api_key: str, model: str) -> list[str]:
    """
    Runs the vision model on the given image to check if the prompt exists.
    Returns a list of timestamps where the prompt was found, or an empty list if none.
    """
    try:
        base64_image = encode_image(image_path)
        client = OpenAI(base_url=api_url, api_key=api_key)
        
        sys_msg = "You are a highly skeptical visual inspector analyzing a video contact sheet. The image contains a grid of thumbnails, and each thumbnail has a timestamp in the bottom right corner.\n\nFirst, scan the photos but keep your description EXTREMELY brief.\nSecond, verify if the requested detail exists in any of the photos. Be strict—do not guess.\nFinally, on a new line at the very end, output exactly: 'RESULT: [timestamps]', where [timestamps] is a comma-separated list of the EXACT timestamps printed on the thumbnails where the detail is present (e.g. 'RESULT: 01:23, 05:45'). If the detail is missing from all thumbnails, output 'RESULT: NONE'."
        user_msg = f"I am searching for the following detail: '{prompt}'.\nLook at all the small photos in this grid. Which specific timestamps show this detail?"
        
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": sys_msg
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_msg},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1000,
            temperature=0.0
        )
        
        raw_answer = response.choices[0].message.content.strip()
        print(f"\n--- Model's Analysis for {os.path.basename(image_path)} ---\n{raw_answer}\n------------------------")
        
        for line in reversed(raw_answer.split('\n')):
            line = line.strip().upper()
            if line.startswith("RESULT:"):
                result_str = line.replace("RESULT:", "").strip()
                if result_str == "NONE" or result_str == "NO":
                    return []
                # Clean up timestamps
                timestamps = [t.strip() for t in result_str.split(',')]
                # Filter out anything that doesn't look like a timestamp
                valid_timestamps = [t for t in timestamps if ':' in t]
                return valid_timestamps
                
        return []
    except Exception as e:
        print(f"Vision Filter Error on {image_path}: {e}")
        return []

def add_tag_to_metadata(video_path: str, new_tag: str, timestamps: list[str] = None):
    """
    Appends a new tag to the video's _metadata.json file, and optionally stores the matched timestamps.
    """
    base_name = os.path.splitext(video_path)[0]
    metadata_path = f"{base_name}_metadata.json"
    
    data = {"tags": [], "ai_matches": {}}
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
            
    if "tags" not in data:
        data["tags"] = []
    if "ai_matches" not in data:
        data["ai_matches"] = {}
        
    if new_tag not in data["tags"]:
        data["tags"].append(new_tag)
        
    if timestamps:
        if new_tag not in data["ai_matches"]:
            data["ai_matches"][new_tag] = []
        # Merge new timestamps and remove duplicates
        existing = set(data["ai_matches"][new_tag])
        for t in timestamps:
            existing.add(t)
        data["ai_matches"][new_tag] = sorted(list(existing))
        
    try:
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving metadata to {metadata_path}: {e}")
