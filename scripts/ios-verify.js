/* Xylonic on-device health probe — run via scripts/ios-debug.sh verify.
 * Returns synchronous checks immediately; kicks the async cache-integrity
 * check onto window.__xyv_cache (ios-debug.sh reads it a moment later). */
(function () {
  var C = window.Capacitor || {};
  var P = (C.Plugins) || {};
  var EXPECT = [
    "BackgroundDownload", "BackgroundKeepAlive", "DownloadNotification",
    "MediaControl", "RemoteDiscovery", "NativeDownloader",
    "Filesystem", "Preferences", "Network", "CapacitorHttp",
  ];
  var have = Object.keys(P);
  var missing = EXPECT.filter(function (n) { return have.indexOf(n) < 0; });

  var ls = {};
  ["username", "serverUrl", "offlineMode", "offlineModeConfig",
   "xylonic_max_concurrent_downloads", "xylonic_default_dl_quality",
   "xylonic_pending_downloads"].forEach(function (k) {
    var v = localStorage.getItem(k);
    if (v && v.length > 120) v = v.slice(0, 120) + "…";
    ls[k] = v;
  });

  var root = document.querySelector(".app") || document.getElementById("root") || document.body;
  var sync = {
    platform: C.getPlatform && C.getPlatform(),
    isNative: C.isNativePlatform && C.isNativePlatform(),
    navigatorOnLine: navigator.onLine,
    title: document.title,
    bundles: Array.prototype.map.call(document.scripts, function (s) {
      return (s.src || "").split("/").pop();
    }).filter(Boolean),
    pluginsPresent: have,
    pluginsMissing: missing,
    domRendered: !!root && root.childElementCount > 0,
    localStorage: ls,
  };

  // async cache integrity — populated shortly after this returns
  window.__xyv_cache = { status: "running" };
  (async function () {
    try {
      var FS = P.Filesystem;
      if (!FS) { window.__xyv_cache = { status: "no Filesystem plugin" }; return; }
      var user = (localStorage.getItem("username") || "") + "@" +
                 (localStorage.getItem("serverUrl") || "").replace(/^https?:\/\//, "").replace(/[:\/]/g, "-");
      var base = "permanent_cache/users/" + user;
      var idxTxt = (await FS.readFile({ path: base + "/cache_index.json", directory: "DATA", encoding: "utf8" })).data;
      var idx = JSON.parse(idxTxt);
      var songs = idx.songs || idx;
      var ids = Object.keys(songs);
      ids.sort(function (a, b) { return (songs[b].cachedAt || 0) - (songs[a].cachedAt || 0); });
      var checked = 0, ok = 0, bad = [];
      for (var i = 0; i < Math.min(8, ids.length); i++) {
        var s = songs[ids[i]], h = s.audioHash;
        var ext = (s.extension || "").replace(/^\./, "");
        var p = "permanent_cache/audio/" + h + "/audio" + (ext ? "." + ext : "");
        checked++;
        try {
          var st = await FS.stat({ path: p, directory: "DATA" });
          if (st.type === "file" && st.size === s.fileSize) ok++;
          else bad.push(s.title + " (disk " + st.size + " vs idx " + s.fileSize + ", " + st.type + ")");
        } catch (e) { bad.push(s.title + " MISSING"); }
      }
      window.__xyv_cache = {
        status: "done", indexSongCount: ids.length,
        sampledNewest: checked, bytesMatch: ok, mismatches: bad,
      };
    } catch (e) {
      window.__xyv_cache = { status: "error", error: String(e && (e.message || e)) };
    }
  })();

  return sync;
})();
