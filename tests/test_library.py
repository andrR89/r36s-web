# tests/test_library.py — library.json do seletor (data/mkmanifest.py write_library)
# python3 -m unittest tests.test_library
import gzip, hashlib, io, json, os, subprocess, sys, tempfile, time, unittest
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SYSTEMS = """<systemList>
<system><name>snes</name><fullname>Super Nintendo</fullname><path>/roms/snes/</path><extension>.sfc .7z</extension></system>
<system><name>psx</name><fullname>PlayStation</fullname><path>/roms/psx</path><extension>.cue .bin .m3u</extension></system>
<system><name>vazio</name><fullname>Sem jogos</fullname><path>/roms/vazio/</path><extension>.zip</extension></system>
<system><name>pico8</name><fullname>PICO-8</fullname><path>/roms/pico-8/carts</path><extension>.png .p8</extension></system>
<system><name>cmds</name><fullname>Comandos</fullname><path>/opt/cmds</path><extension>.sh</extension></system>
<system><name>ports</name><fullname>Ports</fullname><path>/roms/ports/</path><extension>.sh</extension></system>
</systemList>"""
GAMELIST = """<gameList>
<game><path>./Donkey Kong Country 3 (USA).sfc</path><name>Donkey Kong Country 3</name><desc>Dixie e Kiddy.</desc>
<releasedate>19961122T000000</releasedate><players>1-2</players><genre>Plataforma</genre>
<image>./images/DKC3-image.png</image><thumbnail>./images/DKC3-thumb.png</thumbnail><marquee>./images/DKC3-marquee.png</marquee></game>
<game><path>./Apagado.sfc</path><name>Não existe mais</name></game>
</gameList>"""
CORES = {"systems": {"snes": {"core": "snes9x", "fullname": "Super NES", "note": "", "order": 2},
                     "psx": {"core": "pcsx_rearmed", "fullname": "PlayStation", "note": "", "order": 1},
                     "pico-8": {"core": "retro8", "fullname": "PICO-8", "note": "", "order": 5},
                     "ports": {"core": None, "fullname": "Ports", "note": "sem núcleo libretro no dArkOS", "order": 9}}}

def png(w, h, mode="RGB"):
    b = io.BytesIO()
    Image.new(mode, (w, h), (200, 30, 30, 128)[:len(mode)] if mode != "P" else 3).save(b, "PNG")
    return b.getvalue()

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class Library(unittest.TestCase):
    def make(self, drive=False, marquee=False, thumbs=False, real_png=False, src=None, out=None, extra_ids=None):
        src, out = src or tempfile.mkdtemp(), out or tempfile.mkdtemp()
        self.src, self.out = src, out
        touch(src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
        touch(src, "/roms/snes/gamelist.xml", GAMELIST.encode())
        touch(src, "/roms/snes/Donkey Kong Country 3 (USA).sfc", b"R" * 10)
        touch(src, "/roms/snes/Ação Total.7z", b"Z" * 5)
        if not os.path.exists(os.path.join(src, "roms/snes/images/DKC3-thumb.png")):
            touch(src, "/roms/snes/images/DKC3-image.png", png(640, 480) if real_png else b"PNG")
            touch(src, "/roms/snes/images/DKC3-thumb.png", png(600, 800, "RGBA") if real_png else b"PNG")
        if marquee:
            touch(src, "/roms/snes/images/DKC3-marquee.png", b"PNG")
        touch(src, "/roms/psx/Disco (USA).cue", b'FILE "Disco (USA).bin" BINARY\n')
        touch(src, "/roms/psx/Disco (USA).bin", b"BIN")
        touch(src, "/roms/pico-8/carts/jogo.p8.png", b"P8")
        touch(src, "/opt/cmds/run.sh", b"#!/bin/sh")
        touch(src, "/roms/ports/Jogo.sh", b"#!/bin/sh")
        cores = os.path.join(out, "cores.json")
        json.dump(CORES, open(cores, "w"))
        ids = None
        if drive:
            ls = subprocess.check_output([sys.executable, "-I", os.path.join(ROOT, "tests", "mock_drive.py"), "--lsjson", os.path.join(src, "roms")])
            lsj = os.path.join(out, "ls.json"); open(lsj, "wb").write(ls)
            ids = mkmanifest.read_lsjson(lsj)
            ids.update(extra_ids or {})
        mkmanifest.build(src, out, ids, cores, thumbs=os.path.join(out, "capas") if thumbs else None)
        self.assertFalse(os.path.exists(os.path.join(out, "library.json")))   # só o .gz
        with gzip.open(os.path.join(out, "library.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f), ids

    def test_systems_in_cores_order_without_empty(self):
        lib, _ = self.make()
        self.assertEqual([s["id"] for s in lib["systems"]], ["psx", "snes", "pico-8", "ports"])
        snes = lib["systems"][1]
        self.assertEqual((snes["name"], snes["count"], snes["playable"]), ("Super Nintendo", 2, True))
        ports = lib["systems"][3]
        self.assertEqual((ports["playable"], ports["note"]), (False, "sem núcleo libretro no dArkOS"))

    def test_gamelist_metadata_and_fallback_name(self):
        lib, _ = self.make()
        games = {g["rom"]: g for g in lib["games"]}
        dk = games["/roms/snes/Donkey Kong Country 3 (USA).sfc"]
        self.assertEqual((dk["name"], dk["year"], dk["players"], dk["genre"], dk["desc"]),
                         ("Donkey Kong Country 3", 1996, "1-2", "Plataforma", "Dixie e Kiddy."))
        self.assertEqual(dk["box"], "/roms/snes/images/DKC3-thumb.png")
        self.assertEqual(dk["shot"], "/roms/snes/images/DKC3-image.png")
        self.assertNotIn("logo", dk)   # marquee citado mas o arquivo não existe
        self.assertEqual(dk["size"], 10)
        acao = games["/roms/snes/Ação Total.7z"]
        self.assertEqual(acao["name"], "Ação Total")
        self.assertNotIn("/roms/snes/Apagado.sfc", games)   # no gamelist, mas sem arquivo

    def test_system_id_is_folder_under_roms(self):
        lib, _ = self.make()
        pico = next(s for s in lib["systems"] if s["name"] == "PICO-8")
        self.assertEqual((pico["id"], pico["playable"]), ("pico-8", True))   # path é /roms/pico-8/carts
        g = next(g for g in lib["games"] if g["rom"].endswith("jogo.p8.png"))
        self.assertEqual(g["s"], "pico-8")
        self.assertEqual(g["name"], "jogo")   # sem .p8.png (extensões do sistema)

    def test_system_outside_roms_ignored(self):
        lib, _ = self.make()
        self.assertEqual([s["id"] for s in lib["systems"] if s["id"] in ("cmds", "opt")], [])
        self.assertFalse([g for g in lib["games"] if "/opt/" in g["rom"]])

    def test_deterministic_gz(self):
        a = b = None
        for i in (0, 1):
            src, out = tempfile.mkdtemp(), tempfile.mkdtemp()
            touch(src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
            touch(src, "/roms/snes/a.7z", b"Z")
            mkmanifest.build(src, out)
            d = open(os.path.join(out, "library.json.gz"), "rb").read()
            if i == 0: a = d
            else: b = d
        self.assertEqual(a, b)

    def test_cue_hides_cited_bin(self):
        lib, _ = self.make()
        roms = [g["rom"] for g in lib["games"] if g["s"] == "psx"]
        self.assertEqual(roms, ["/roms/psx/Disco (USA).cue"])

    def test_drive_refs_are_ids(self):
        lib, ids = self.make(drive=True)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        box = ids["snes/images/DKC3-thumb.png"]
        want = box["id"] + ("." + box["v"][:6] if box["v"] else "")
        self.assertEqual(dk["box"], want)   # "<id>.<6 primeiros da versão>": string compacta (IDs do Drive não comprimem)
        self.assertFalse(dk["box"].startswith("/"))
        # sem o ID da ROM (o download pega do manifest) nem logo (a interface não usa)
        for g in lib["games"]:
            self.assertNotIn("id", g)
            self.assertNotIn("logo", g)
            for k in ("box", "shot"):
                if k in g:
                    self.assertRegex(g[k], r"^[^./]+(\.[^.]{1,6})?$")

    def test_no_logo_even_if_marquee_exists(self):
        lib, _ = self.make(marquee=True)
        for g in lib["games"]:
            self.assertNotIn("logo", g)

DK_THUMB = "snes/" + hashlib.sha1(b"/roms/snes/images/DKC3-thumb.png").hexdigest()[:16] + ".webp"

class Thumbs(unittest.TestCase):
    make = Library.make

    def test_no_thumbs_option_no_thumb_key(self):
        lib, _ = self.make(real_png=True)
        self.assertFalse([g for g in lib["games"] if "thumb" in g])
        self.assertFalse(os.path.exists(os.path.join(self.out, "capas")))

    def test_hub_thumb_webp_300_wide(self):
        lib, _ = self.make(real_png=True, thumbs=True)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        self.assertEqual(dk["thumb"], "@capas/" + DK_THUMB)   # relativo à pasta do índice
        self.assertEqual(dk["box"], "/roms/snes/images/DKC3-thumb.png")   # a original continua (ficha)
        p = os.path.join(self.out, "capas", DK_THUMB)
        with Image.open(p) as im:
            self.assertEqual((im.format, im.size, im.mode), ("WEBP", (300, 400), "RGBA"))   # box (600x800), não shot
            self.assertNotIn("exif", im.info)
        others = [g for g in lib["games"] if g["name"] != "Donkey Kong Country 3"]
        self.assertFalse([g for g in others if "thumb" in g])   # sem imagem: sem miniatura

    def test_small_source_scaled_to_300(self):
        src = tempfile.mkdtemp()
        touch(src, "/roms/snes/images/DKC3-image.png", png(64, 48))
        touch(src, "/roms/snes/images/DKC3-thumb.png", png(160, 120, "P"))
        self.make(src=src, thumbs=True)
        with Image.open(os.path.join(self.out, "capas", DK_THUMB)) as im:
            self.assertEqual((im.size, im.mode), ((300, 225), "RGB"))

    def test_second_build_skips(self):
        self.make(real_png=True, thumbs=True)
        p = os.path.join(self.out, "capas", DK_THUMB)
        old = time.time() - 100
        os.utime(os.path.join(self.src, "roms/snes/images/DKC3-thumb.png"), (old - 100, old - 100))
        os.utime(p, (old, old))
        lib, _ = self.make(src=self.src, out=self.out, thumbs=True)
        self.assertEqual(os.path.getmtime(p), old)   # não refez
        self.assertIn("thumb", next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3"))
        # fonte mais nova que a miniatura: refaz
        os.utime(os.path.join(self.src, "roms/snes/images/DKC3-thumb.png"), (old + 50, old + 50))
        self.make(src=self.src, out=self.out, thumbs=True)
        self.assertGreater(os.path.getmtime(p), old)

    def test_bad_image_no_thumb(self):
        lib, _ = self.make(thumbs=True)   # "PNG" de 3 bytes: Pillow não abre
        self.assertFalse([g for g in lib["games"] if "thumb" in g])

    def test_drive_thumb_id_from_lsjson(self):
        fake = {".web/capas/" + DK_THUMB: {"id": "1ThumbID", "size": 9000, "v": "abcdef1234"}}
        lib, _ = self.make(real_png=True, thumbs=True, drive=True, extra_ids=fake)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        self.assertEqual(dk["thumb"], "1ThumbID.abcdef")
        self.assertTrue(os.path.exists(os.path.join(self.out, "capas", DK_THUMB)))

    def test_drive_thumb_not_uploaded_yet(self):
        lib, _ = self.make(real_png=True, thumbs=True, drive=True)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        self.assertNotIn("thumb", dk)
        self.assertIn("box", dk)

if __name__ == "__main__":
    unittest.main()
