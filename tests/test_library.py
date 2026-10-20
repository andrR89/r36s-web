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
<game><path>./Ação Total.7z</path><image>./images/acao.png</image></game>
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
    def make(self, drive=False, marquee=False, thumbs=False, real_png=False, src=None, out=None, extra_ids=None, drop_ids=()):
        src, out = src or tempfile.mkdtemp(), out or tempfile.mkdtemp()
        self.src, self.out = src, out
        touch(src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
        touch(src, "/roms/snes/gamelist.xml", GAMELIST.encode())
        touch(src, "/roms/snes/Donkey Kong Country 3 (USA).sfc", b"R" * 10)
        touch(src, "/roms/snes/Ação Total.7z", b"Z" * 5)
        if not os.path.exists(os.path.join(src, "roms/snes/images/DKC3-thumb.png")):
            touch(src, "/roms/snes/images/DKC3-image.png", png(640, 480) if real_png else b"PNG")
            touch(src, "/roms/snes/images/DKC3-thumb.png", png(600, 800, "RGBA") if real_png else b"PNG")
            if real_png:
                touch(src, "/roms/snes/images/acao.png", png(320, 240))
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
            for k in drop_ids:
                del ids[k]
        self.cache = os.path.join(out, ".capas-cache")
        mkmanifest.build(src, out, ids, cores, thumbs=self.cache if thumbs else None)
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

# nome no cache: sha1(vpath da fonte + parâmetros da miniatura): mudar largura/qualidade refaz tudo
tname = lambda vp, params=mkmanifest.THUMB_PARAMS: "snes/" + hashlib.sha1(f"{vp}\0{params}".encode()).hexdigest()[:16] + ".webp"
DK_THUMB = tname("/roms/snes/images/DKC3-thumb.png")
ACAO_THUMB = tname("/roms/snes/images/acao.png")

class Thumbs(unittest.TestCase):
    make = Library.make

    def games(self, lib):
        return {g["name"]: g for g in lib["games"]}

    def pack(self):
        return open(os.path.join(self.out, "capas", "snes.bin"), "rb").read()

    def test_no_thumbs_option_no_thumb_key(self):
        lib, _ = self.make(real_png=True)
        self.assertFalse([g for g in lib["games"] if "thumb" in g])
        self.assertFalse([s for s in lib["systems"] if "capas" in s])
        self.assertFalse(os.path.exists(os.path.join(self.out, "capas")))

    def test_hub_pack_per_system(self):
        lib, _ = self.make(real_png=True, thumbs=True)
        snes = next(s for s in lib["systems"] if s["id"] == "snes")
        pack = self.pack()
        # "@" = relativo à pasta do índice; "?<versão>" = sha1 do pacote (o cache do navegador não serve recorte velho)
        self.assertEqual(snes["capas"], "@capas/snes.bin?" + hashlib.sha1(pack).hexdigest()[:8])
        self.assertFalse([s for s in lib["systems"] if s["id"] != "snes" and "capas" in s])   # sem imagens: sem pacote
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, "capas"))), ["snes.bin"])
        g = self.games(lib)
        dk, acao = g["Donkey Kong Country 3"], g["Ação Total"]
        # ordem do library (Ação Total < Donkey Kong): pacote = concatenação das miniaturas do cache
        self.assertEqual(acao["thumb"], [0, os.path.getsize(os.path.join(self.cache, ACAO_THUMB))])
        self.assertEqual(dk["thumb"][0], acao["thumb"][1])
        self.assertEqual(len(pack), dk["thumb"][0] + dk["thumb"][1])
        for game, name in ((dk, DK_THUMB), (acao, ACAO_THUMB)):
            off, n = game["thumb"]
            self.assertEqual(pack[off:off + n], open(os.path.join(self.cache, name), "rb").read())
        with Image.open(io.BytesIO(pack[dk["thumb"][0]:])) as im:
            self.assertEqual((im.format, im.size, im.mode), ("WEBP", (300, 400), "RGBA"))   # box (600x800), não shot
            self.assertNotIn("exif", im.info)
        self.assertEqual(dk["box"], "/roms/snes/images/DKC3-thumb.png")   # a original continua (ficha)
        self.assertFalse([x for x in lib["games"] if x["s"] != "snes" and "thumb" in x])

    def test_pack_deterministic(self):
        lib1, _ = self.make(real_png=True, thumbs=True)
        a = self.pack()
        os.utime(os.path.join(self.src, "roms/snes/images/acao.png"), None)   # refaz uma miniatura
        lib2, _ = self.make(src=self.src, out=self.out, thumbs=True)
        self.assertEqual(self.pack(), a)
        self.assertEqual(lib1, lib2)

    def test_stale_pack_removed(self):
        self.make(real_png=True, thumbs=True)
        open(os.path.join(self.out, "capas", "velho.bin"), "wb").write(b"x")
        os.makedirs(os.path.join(self.out, "capas", "snes"))   # miniaturas soltas do formato antigo
        open(os.path.join(self.out, "capas", "snes", "a.webp"), "wb").write(b"x")
        self.make(src=self.src, out=self.out, thumbs=True)
        self.assertEqual(os.listdir(os.path.join(self.out, "capas")), ["snes.bin"])

    def test_small_source_scaled_to_300(self):
        src = tempfile.mkdtemp()
        touch(src, "/roms/snes/images/DKC3-image.png", png(64, 48))
        touch(src, "/roms/snes/images/DKC3-thumb.png", png(160, 120, "P"))
        self.make(src=src, thumbs=True)
        with Image.open(os.path.join(self.cache, DK_THUMB)) as im:
            self.assertEqual((im.size, im.mode), ((300, 225), "RGB"))

    def test_second_build_skips(self):
        self.make(real_png=True, thumbs=True)
        p, srcp = os.path.join(self.cache, DK_THUMB), os.path.join(self.src, "roms/snes/images/DKC3-thumb.png")
        self.assertEqual(os.stat(p).st_mtime_ns, os.stat(srcp).st_mtime_ns)   # a miniatura leva a data da fonte
        ino = os.stat(p).st_ino
        lib, _ = self.make(src=self.src, out=self.out, thumbs=True)
        self.assertEqual(os.stat(p).st_ino, ino)   # não refez (refazer grava outro arquivo e renomeia)
        self.assertIn("thumb", self.games(lib)["Donkey Kong Country 3"])
        # fonte com outra data (mais nova ou mais velha: trocada por uma cópia antiga): refaz
        for t in (time.time() + 50, time.time() - 5000):
            os.utime(srcp, (t, t))
            self.make(src=self.src, out=self.out, thumbs=True)
            self.assertNotEqual(os.stat(p).st_ino, ino); ino = os.stat(p).st_ino
            self.assertEqual(os.stat(p).st_mtime_ns, os.stat(srcp).st_mtime_ns)

    def test_params_in_cache_name(self):
        self.assertIn("300", mkmanifest.THUMB_PARAMS)
        old = (mkmanifest.THUMB_W, mkmanifest.THUMB_PARAMS)
        try:
            mkmanifest.THUMB_W, mkmanifest.THUMB_PARAMS = 200, "w200q72m6"
            self.make(real_png=True, thumbs=True)
        finally:
            mkmanifest.THUMB_W, mkmanifest.THUMB_PARAMS = old
        with Image.open(os.path.join(self.cache, tname("/roms/snes/images/DKC3-thumb.png", "w200q72m6"))) as im:
            self.assertEqual(im.size, (200, 267))   # largura passada ao processo que gera (não a do módulo lá)
        self.assertFalse(os.path.exists(os.path.join(self.cache, DK_THUMB)))

    def test_bad_image_no_thumb(self):
        lib, _ = self.make(thumbs=True)   # "PNG" de 3 bytes: Pillow não abre
        self.assertFalse([g for g in lib["games"] if "thumb" in g])
        self.assertFalse([s for s in lib["systems"] if "capas" in s])

    def local_pack(self, **kw):
        self.make(real_png=True, thumbs=True, **kw)
        return self.pack()

    def test_drive_pack_id_from_lsjson(self):
        md5 = hashlib.md5(self.local_pack()).hexdigest()
        fake = {".web/capas/snes.bin": {"id": "1PackID", "size": 9000, "v": md5[:10]}}
        lib, _ = self.make(src=self.src, real_png=True, thumbs=True, drive=True, extra_ids=fake)
        snes = next(s for s in lib["systems"] if s["id"] == "snes")
        self.assertEqual(snes["capas"], "1PackID." + md5[:6])
        self.assertEqual(self.games(lib)["Donkey Kong Country 3"]["thumb"][1] > 0, True)
        self.assertTrue(os.path.exists(os.path.join(self.out, "capas", "snes.bin")))   # o pacote a subir

    def test_drive_pack_md5_mismatch(self):
        fake = {".web/capas/snes.bin": {"id": "1PackID", "size": 9000, "v": "abcdef1234"}}   # pacote antigo no Drive
        lib, _ = self.make(real_png=True, thumbs=True, drive=True, extra_ids=fake)
        self.assertFalse([s for s in lib["systems"] if "capas" in s])
        self.assertFalse([g for g in lib["games"] if "thumb" in g])   # offsets do pacote novo não servem no antigo

    def test_drive_pack_same_as_local_even_without_image_ids(self):
        local = self.local_pack()
        # a capa não está na listagem do Drive (jogo fica sem "box"), mas a miniatura sai do arquivo local: mesmo pacote
        lib, _ = self.make(src=self.src, real_png=True, thumbs=True, drive=True, drop_ids=("snes/images/DKC3-thumb.png",),
                           extra_ids={".web/capas/snes.bin": {"id": "1P", "size": 1, "v": hashlib.md5(local).hexdigest()[:10]}})
        self.assertEqual(self.pack(), local)
        dk = self.games(lib)["Donkey Kong Country 3"]
        self.assertNotIn("box", dk)
        self.assertIn("thumb", dk)

    def test_drive_pack_not_uploaded_yet(self):
        lib, _ = self.make(real_png=True, thumbs=True, drive=True)
        self.assertFalse([s for s in lib["systems"] if "capas" in s])
        dk = self.games(lib)["Donkey Kong Country 3"]
        self.assertNotIn("thumb", dk)   # sem pacote no Drive: offsets não servem
        self.assertIn("box", dk)

if __name__ == "__main__":
    unittest.main()
