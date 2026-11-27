// Opened by Discord as an Activity (in a voice call)? Then load Discord sign-in and the "In this call" panel
// before the game starts. A file of its own, not inline, because Discord's page rules may block inline scripts.
if (new URLSearchParams(location.search).has("frame_id")) {
  document.write('<script src="vendor/discord-sdk.js?v=2.5.0"><\/script><script src="vendor/socket.io.min.js?v=4.7.5"><\/script><script src="activity.js?v=20261127b"><\/script>');
}
