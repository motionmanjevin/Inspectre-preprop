import tkinter as tk
from tkinter import filedialog, messagebox
import subprocess
import os

video_paths = ["", "", "", ""]
labels = ["Cam 1", "Cam 2", "Cam 3", "Cam 4"]

# ✅ IMPORTANT: Set font path (fixes your error)
FONT_PATH = "C\\:/Windows/Fonts/arial.ttf"

def select_video(index):
    path = filedialog.askopenfilename(
        filetypes=[("Video Files", "*.mp4 *.avi *.mkv")]
    )
    if path:
        video_paths[index] = path
        buttons[index].config(text=os.path.basename(path))

def generate_grid():
    if "" in video_paths:
        messagebox.showerror("Error", "Please select all 4 videos")
        return

    output_path = filedialog.asksaveasfilename(
        defaultextension=".mp4",
        filetypes=[("MP4 files", "*.mp4")]
    )
    if not output_path:
        return

    # Get labels
    for i in range(4):
        labels[i] = entries[i].get()

    filter_complex = f"""
    nullsrc=size=1280x720 [base];

    [0:v] setpts=PTS-STARTPTS, scale=640x360,
    drawtext=fontfile='{FONT_PATH}':text='{labels[0]}':x=10:y=20:fontsize=20:fontcolor=white [v0];

    [1:v] setpts=PTS-STARTPTS, scale=640x360,
    drawtext=fontfile='{FONT_PATH}':text='{labels[1]}':x=10:y=20:fontsize=20:fontcolor=white [v1];

    [2:v] setpts=PTS-STARTPTS, scale=640x360,
    drawtext=fontfile='{FONT_PATH}':text='{labels[2]}':x=10:y=20:fontsize=20:fontcolor=white [v2];

    [3:v] setpts=PTS-STARTPTS, scale=640x360,
    drawtext=fontfile='{FONT_PATH}':text='{labels[3]}':x=10:y=20:fontsize=20:fontcolor=white [v3];

    [base][v0] overlay=shortest=1:x=0:y=0 [tmp1];
    [tmp1][v1] overlay=shortest=1:x=640:y=0 [tmp2];
    [tmp2][v2] overlay=shortest=1:x=0:y=360 [tmp3];
    [tmp3][v3] overlay=shortest=1:x=640:y=360
    """

    cmd = [
        "ffmpeg",
        "-y",  # overwrite output
        "-i", video_paths[0],
        "-i", video_paths[1],
        "-i", video_paths[2],
        "-i", video_paths[3],
        "-filter_complex", filter_complex,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        output_path
    ]

    try:
        subprocess.run(cmd, check=True)
        messagebox.showinfo("Success", "✅ 2x2 grid video created!")
    except subprocess.CalledProcessError:
        messagebox.showerror("Error", "❌ FFmpeg failed. Check console.")

# GUI
root = tk.Tk()
root.title("2x2 Video Grid Maker")

buttons = []
entries = []

for i in range(4):
    frame = tk.Frame(root)
    frame.pack(pady=5)

    btn = tk.Button(
        frame,
        text=f"Select Video {i+1}",
        width=25,
        command=lambda i=i: select_video(i)
    )
    btn.pack(side="left")
    buttons.append(btn)

    entry = tk.Entry(frame, width=20)
    entry.insert(0, labels[i])
    entry.pack(side="left", padx=5)
    entries.append(entry)

generate_btn = tk.Button(
    root,
    text="Generate 2x2 Grid",
    command=generate_grid,
    bg="green",
    fg="white"
)
generate_btn.pack(pady=10)

root.mainloop()