import cv2
import numpy as np
import time
from datetime import datetime
import os


class MotionRecorder:
    def __init__(self, rtsp_url, recording_duration_seconds, motion_threshold=500, output_dir="recordings"):
        """
        Initialize the Motion Recorder
        
        Args:
            rtsp_url: RTSP stream URL
            recording_duration_seconds: Duration of each recording chunk in seconds
            motion_threshold: Minimum contour area to consider as motion (lower = more sensitive)
            output_dir: Directory to save recordings
        """
        self.rtsp_url = rtsp_url
        self.recording_duration = recording_duration_seconds
        self.output_dir = output_dir
        self.cap = None
        self.recording = False
        self.min_contour_area = motion_threshold  # Minimum area to consider as motion
        
        # Create output directory if it doesn't exist
        os.makedirs(self.output_dir, exist_ok=True)
        
        # For frame differencing
        self.prev_frame = None
        self.frame_count = 0
        
    def connect_stream(self):
        """Connect to RTSP stream"""
        print(f"Connecting to RTSP stream: {self.rtsp_url}")
        self.cap = cv2.VideoCapture(self.rtsp_url)
        
        # Set buffer size to reduce latency
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        if not self.cap.isOpened():
            raise Exception(f"Failed to open RTSP stream: {self.rtsp_url}")
        
        # Read a few frames to stabilize
        for _ in range(5):
            ret, _ = self.cap.read()
            if not ret:
                raise Exception("Failed to read from stream")
        
        print("Successfully connected to stream")
        
    def detect_motion(self, frame):
        """
        Detect motion using frame differencing
        
        Args:
            frame: Current frame from camera
            
        Returns:
            bool: True if motion detected, False otherwise
        """
        if frame is None:
            return False
        
        # Convert to grayscale
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Apply Gaussian blur to reduce noise
        gray = cv2.GaussianBlur(gray, (21, 21), 0)
        
        # Initialize previous frame on first call
        if self.prev_frame is None:
            self.prev_frame = gray
            return False
        
        # Calculate frame difference
        frame_diff = cv2.absdiff(self.prev_frame, gray)
        
        # Apply threshold
        thresh = cv2.threshold(frame_diff, 25, 255, cv2.THRESH_BINARY)[1]
        
        # Dilate to fill holes
        thresh = cv2.dilate(thresh, None, iterations=2)
        
        # Find contours
        contours, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Check if any contour is large enough to indicate motion
        motion_detected = False
        for contour in contours:
            if cv2.contourArea(contour) > self.min_contour_area:
                motion_detected = True
                break
        
        # Update previous frame
        self.prev_frame = gray
        
        return motion_detected
    
    def wait_for_motion(self):
        """
        Wait until motion is detected in the stream
        
        Returns:
            bool: True if motion detected, False if stream ended
        """
        print("Waiting for motion...")
        motion_detected = False
        
        while not motion_detected:
            ret, frame = self.cap.read()
            if not ret:
                print("Failed to read frame from stream")
                return False
            
            motion_detected = self.detect_motion(frame)
            
            if motion_detected:
                print("Motion detected! Starting recording...")
        
        return True
    
    def record_chunk(self):
        """
        Record a chunk of video for the specified duration
        
        Returns:
            bool: True if recording successful, False otherwise
        """
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(self.output_dir, f"recording_{timestamp}.mp4")
        
        # Get video properties
        fps = int(self.cap.get(cv2.CAP_PROP_FPS))
        if fps == 0:
            fps = 25  # Default FPS if not available
        
        width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Define codec and create VideoWriter
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(filename, fourcc, fps, (width, height))
        
        if not out.isOpened():
            print(f"Failed to open video writer for {filename}")
            return False
        
        print(f"Recording started: {filename}")
        start_time = time.time()
        frames_recorded = 0
        
        while True:
            elapsed = time.time() - start_time
            
            if elapsed >= self.recording_duration:
                break
            
            ret, frame = self.cap.read()
            if not ret:
                print("Failed to read frame during recording")
                break
            
            # Write frame
            out.write(frame)
            frames_recorded += 1
            
            # Print progress every second
            if frames_recorded % fps == 0:
                remaining = self.recording_duration - elapsed
                print(f"Recording... {remaining:.1f}s remaining", end='\r')
        
        # Release video writer
        out.release()
        print(f"\nRecording completed: {filename} ({frames_recorded} frames)")
        
        # Reset motion detection baseline after recording
        # Flush a few frames and reset prev_frame to avoid false positives
        print("Resetting motion detection baseline...")
        for _ in range(10):  # Flush 10 frames to clear buffer
            ret, frame = self.cap.read()
            if ret:
                # Update prev_frame with the latest frame as new baseline
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                gray = cv2.GaussianBlur(gray, (21, 21), 0)
                self.prev_frame = gray
        
        return True
    
    def run(self):
        """Main loop: wait for motion -> record chunk -> repeat"""
        try:
            self.connect_stream()
            
            print("\nMotion Recorder Started")
            print("Press Ctrl+C to quit at any time\n")
            
            chunk_number = 1
            
            while True:
                # Wait for motion before recording
                if not self.wait_for_motion():
                    print("Stream ended or user quit")
                    break
                
                # Record chunk
                print(f"\n--- Recording Chunk #{chunk_number} ---")
                if not self.record_chunk():
                    print("Recording failed")
                    break
                
                chunk_number += 1
                print(f"Chunk #{chunk_number - 1} completed. Waiting for motion again...\n")
                
        except KeyboardInterrupt:
            print("\nInterrupted by user")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.cleanup()
    
    def cleanup(self):
        """Clean up resources"""
        if self.cap:
            self.cap.release()
        print("Cleanup completed")


def main():
    """Main function to get user input and start recording"""
    print("=" * 60)
    print("RTSP Motion-Based Recorder")
    print("=" * 60)
    print()
    
    # Get RTSP URL
    rtsp_url = input("Enter RTSP stream URL: ").strip()
    if not rtsp_url:
        print("Error: RTSP URL cannot be empty")
        return
    
    # Get recording duration
    while True:
        try:
            duration_input = input("Enter recording duration per chunk (in seconds): ").strip()
            duration = float(duration_input)
            if duration <= 0:
                print("Error: Duration must be greater than 0")
                continue
            break
        except ValueError:
            print("Error: Please enter a valid number")
    
    # Get motion detection threshold
    print("\nMotion Detection Threshold:")
    print("  Lower values = more sensitive (detects smaller movements)")
    print("  Higher values = less sensitive (only detects larger movements)")
    print("  Recommended range: 200-2000 (default: 500)")
    while True:
        try:
            threshold_input = input("Enter motion detection threshold (default 500): ").strip()
            if not threshold_input:
                threshold = 500  # Default value
                break
            threshold = float(threshold_input)
            if threshold <= 0:
                print("Error: Threshold must be greater than 0")
                continue
            break
        except ValueError:
            print("Error: Please enter a valid number")
    
    print()
    print("Configuration:")
    print(f"  RTSP URL: {rtsp_url}")
    print(f"  Recording Duration: {duration} seconds per chunk")
    print(f"  Motion Detection Threshold: {threshold}")
    print()
    
    input("Press Enter to start recording (or Ctrl+C to cancel)...")
    print()
    
    # Create and run recorder
    recorder = MotionRecorder(rtsp_url, duration, threshold)
    recorder.run()


if __name__ == "__main__":
    main()
