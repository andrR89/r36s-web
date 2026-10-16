# tests/test_mkmanifest.py
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class T(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b"<config/>")
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList/>")
        touch(self.src, "/roms/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.src, "/roms/snes/images/Jogo (USA).png", b"PNG")
        touch(self.src, "/roms/themes/t/snes/fundo.jpg", b"JPGDATA")
        touch(self.src, "/roms/themes/t/bgm.mp3", b"MP3DATA")
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_eager_files_are_in_blob(self):
        for path, data in [("/roms/themes/t/theme.xml", b"<theme/>"),
                           ("/home/ark/.emulationstation/es_settings.cfg", b"<config/>"),
                           ("/roms/snes/gamelist.xml", b"<gameList/>")]:
            f = self.m["files"][path]
            self.assertEqual(f["kind"], "eager")
            self.assertEqual(self.blob[f["off"]:f["off"] + f["size"]], data)

    def test_rom_is_empty_and_not_in_blob(self):
        f = self.m["files"]["/roms/snes/Jogo (USA).7z"]
        self.assertEqual(f["kind"], "empty")
        self.assertNotIn(b"ROMDATA", self.blob)

    def test_image_is_lazy_with_url(self):
        f = self.m["files"]["/roms/snes/images/Jogo (USA).png"]
        self.assertEqual(f["kind"], "lazy")
        self.assertEqual(f["size"], 3)
        self.assertEqual(f["url"], "fs/roms/snes/images/Jogo%20%28USA%29.png")

    def test_theme_media_is_lazy(self):
        for path in ["/roms/themes/t/snes/fundo.jpg", "/roms/themes/t/bgm.mp3"]:
            self.assertEqual(self.m["files"][path]["kind"], "lazy")
        self.assertNotIn(b"JPGDATA", self.blob)

    def test_dirs_and_symlink(self):
        self.assertIn("/roms/snes/images", self.m["dirs"])
        self.assertEqual(self.m["symlinks"]["/etc/emulationstation/themes"], "/roms/themes")

if __name__ == "__main__":
    unittest.main()
