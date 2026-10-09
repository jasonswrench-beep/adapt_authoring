"""Builds sample-video.pptx: a title slide with an embedded video, a slide with embedded audio, a slide with a
non-web video format, and a slide with two videos. Needs: python-pptx, pillow and ffmpeg (for the tiny clips)."""
import io, os, subprocess, sys, tempfile
from pptx import Presentation
from pptx.util import Inches
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else 'sample-video.pptx'
tmp = tempfile.mkdtemp()
def clip(name, *args):
    path = os.path.join(tmp, name)
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + list(args) + [path], check=True)
    return path

mp4 = clip('lecture.mp4', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest')
wav = clip('note.wav', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.5', '-ar', '8000', '-ac', '1')
avi = clip('old.avi', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=0.5', '-c:v', 'mpeg4')
buf = io.BytesIO(); Image.new('RGB', (160, 90), 'steelblue').save(buf, 'PNG'); buf.seek(0)

prs = Presentation()
prs.core_properties.title = 'Emoting 101'

s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = 'Emoting 101'
s.shapes.add_movie(mp4, Inches(1), Inches(2), Inches(4), Inches(2.25), poster_frame_image=io.BytesIO(buf.getvalue()), mime_type='video/mp4')

s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = 'Listen to this'
s.shapes.add_movie(wav, Inches(1), Inches(2), Inches(1), Inches(1), poster_frame_image=io.BytesIO(buf.getvalue()), mime_type='audio/wav')

s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = 'Old format'
s.shapes.add_movie(avi, Inches(1), Inches(2), Inches(2), Inches(1.5), poster_frame_image=io.BytesIO(buf.getvalue()), mime_type='video/avi')

s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = 'Two clips'
s.shapes.add_movie(mp4, Inches(0.5), Inches(2), Inches(3), Inches(1.7), poster_frame_image=io.BytesIO(buf.getvalue()), mime_type='video/mp4')
s.shapes.add_movie(wav, Inches(5), Inches(2), Inches(1), Inches(1), poster_frame_image=io.BytesIO(buf.getvalue()), mime_type='audio/wav')

prs.save(out)
print('wrote', out)
