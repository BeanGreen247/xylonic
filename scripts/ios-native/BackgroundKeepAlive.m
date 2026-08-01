#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BackgroundKeepAlivePlugin, "BackgroundKeepAlive",
  CAP_PLUGIN_METHOD(arm,   CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(disarm, CAPPluginReturnPromise);
)
