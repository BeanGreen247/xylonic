#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BackgroundDownloadPlugin, "BackgroundDownload",
  CAP_PLUGIN_METHOD(startDownload,      CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(cancelDownload,     CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(readCompletionLog,  CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(clearCompletionLog, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(probeConnection,    CAPPluginReturnPromise);
)
