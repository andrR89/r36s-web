# tests/test_saves.py — rotas GET/PUT /r36s/saves/<sistema>/<arquivo> do hub (~/Workspace/web-ports/hub.py)
# roda o hub num diretório temporário (WEBPORTS_BASE) e numa porta livre: python3 -m unittest tests.test_saves
import http.client, os, socket, subprocess, sys, tempfile, time, unittest, urllib.parse

HUB = os.path.join(os.path.dirname(__file__), "..", "..", "hub.py")

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

class SavesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.base = cls.tmp.name
        os.makedirs(os.path.join(cls.base, "r36s/web"))
        os.makedirs(os.path.join(cls.base, "outro/web"))
        open(os.path.join(cls.base, "outro/web/index.html"), "w").write("outro")
        cls.port = free_port()
        cls.proc = subprocess.Popen([sys.executable, "-I", HUB, str(cls.port)], env={**os.environ, "WEBPORTS_BASE": cls.base},
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", cls.port), 0.1).close(); break
            except OSError:
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(); cls.tmp.cleanup()

    def req(self, method, path, body=None, quote=True):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(method, urllib.parse.quote(path) if quote else path, body=body)
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, data

    def disk(self, *p):
        return os.path.join(self.base, "r36s/saves", *p)

    def test_get_missing_404(self):
        self.assertEqual(self.req("GET", "/r36s/saves/snes/nada.srm")[0], 404)

    def test_put_get_bak(self):
        name = "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA) (PT-BR).srm"
        path = "/r36s/saves/snes/" + name
        self.assertIn(self.req("PUT", path, b"v1" * 1024)[0], (200, 201, 204))
        self.assertEqual(open(self.disk("snes", name), "rb").read(), b"v1" * 1024)
        st, data = self.req("GET", path)
        self.assertEqual((st, data), (200, b"v1" * 1024))
        self.assertIn(self.req("PUT", path, b"v2" * 1024)[0], (200, 201, 204))
        self.assertEqual(self.req("GET", path)[1], b"v2" * 1024)
        self.assertEqual(open(self.disk("snes", name + ".bak"), "rb").read(), b"v1" * 1024)

    def test_traversal_400(self):
        for p in ("/r36s/saves/snes/../../web/x.srm", "/r36s/saves/../hub.py", "/r36s/saves/snes/%2e%2e/x",
                  "/r36s/saves/snes/a/b.srm", "/r36s/saves/snes/", "/r36s/saves/x.srm", "/r36s/saves/.hidden/x.srm"):
            for m in ("GET", "PUT"):
                st, _ = self.req(m, p, b"x" if m == "PUT" else None, quote=False)
                self.assertEqual(st, 400, f"{m} {p}")
        self.assertFalse(os.path.exists(os.path.join(self.base, "r36s/web/x.srm")))

    def test_too_big_413(self):
        # o hub recusa só pelo Content-Length, sem ler o corpo
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.putrequest("PUT", "/r36s/saves/snes/grande.srm")
        c.putheader("Content-Length", str(16 * 1024 * 1024 + 1)); c.endheaders()
        self.assertEqual(c.getresponse().status, 413); c.close()
        self.assertFalse(os.path.exists(self.disk("snes", "grande.srm")))

    def test_other_sites_untouched(self):
        self.assertEqual(self.req("GET", "/outro/index.html"), (200, b"outro"))
        self.assertNotEqual(self.req("PUT", "/outro/saves/snes/x.srm", b"x")[0], 200)
        self.assertFalse(os.path.exists(os.path.join(self.base, "outro/saves")))

if __name__ == "__main__":
    unittest.main()
