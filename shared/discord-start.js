// Discord opens the ACEdle Activity at the top of the site; send it on to ACEdle (keeping Discord's details).
if (new URLSearchParams(location.search).has("frame_id")) location.replace("acedle/" + location.search);
