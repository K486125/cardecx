import http.server, functools, sys
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
S(('127.0.0.1', 5055), H).serve_forever()
