// Word packs for Ace Agents. Add a pack by adding a key here; it shows up in the pack menu.
// Each pack needs at least 25 different words. Duplicates are removed automatically.
// Changing a pack's list changes which board a game code makes, so old links show new boards.
window.WORD_PACKS = {
  classic: {
    name: "Classic",
    words: `apple anchor arrow atlas badge ball band bank bark bat battery beach bear bell belt bench
      berry bill bird blade block board boat bolt bond book boot bottle bow box brain branch brick bridge
      brush bubble bucket bug cabin cable cake camel camera camp candle cap captain car card carpet castle
      cat cave cell chain chair chalk charge check cheese chess chest chip circle clock cloud club coach
      coat code coin comet compass cone cook copper coral cotton court cover crab crane crash crown crystal
      cup current curtain cycle dance date deck desert diamond dice disc doctor dog dollar door dragon drill
      drum duck eagle echo egg engine eye fall fan farm feather fence field file film fire fish flag flash
      flute fly fog forest fork fountain fox frame frog frost game garden gas ghost giant glass glove gold
      grass guitar hammer hand harbor hat hawk heart helmet honey hook horn horse hospital hotel ice iron
      island jacket jam jet jewel judge jungle key king kite knife knight ladder lake lamp laser lead leaf
      lemon letter light lightning line lion lock log magnet mail map marble mark mask match maze medal
      mercury mint mirror mole moon mountain mouse mud nail needle net night note nurse nut oak ocean
      octopus oil olive opera orange organ owl page paint palm pan paper park parrot party pass pen penguin
      piano pie pilot pin pipe pirate pitch planet plant plate point pole pool port post pot pound press
      prince pumpkin pupil puzzle pyramid queen rabbit racket radio rain ring river robot rock rocket roll
      root rose ruler saddle salt sand satellite scale school screen seal shadow shark sheep shell ship
      shoe shop signal silk sink skate skull sky slip snake snow soap sock soldier space spell spider spike
      spine spoon spring square stadium staff star station steam stick stone storm stream string sugar
      suit sun swing sword table tail tank teacher temple tent thread throne thunder ticket tiger tooth
      torch tower track train trap tree triangle truck trunk tube tunnel turtle umbrella unicorn vacuum van
      violin volcano wall watch water wave web well whale wheel whip wind window wing wire witch wolf worm
      yard zebra`
  },
  gamer: {
    name: "Gamer",
    words: `ace aim ammo armor arena avatar boss bot buff bunker camper carry checkpoint clan clutch combo
      console controller cooldown crate crit crosshair defuse dungeon emote flank frag glitch grind guild
      headshot healer hitbox inventory joystick keyboard lag lobby loot mana map mod mouse nerf noob patch
      ping pixel portal potion quest queue rage rank raid respawn rush sandbox scope server shield skin
      smoke sniper spawn speedrun squad stream tank teleport trophy turret ultimate vault ward zombie
      achievement admin agent bounty cheat coin diamond dragon elixir flag grenade hotbar island jump knife
      lava level minion ore pickaxe recoil reload ruby save sword totem upgrade warp wipe zone headset mic
      tournament trade ranked replay kit perk pet gold gem forge bow party leaderboard champion rookie
      ghost hacker wizard castle treasure boost combo shop chest pvp map tutorial`
  }
};

// Words used to make game codes like FALCON-42.
window.CODE_WORDS = `falcon viper cobra raven ghost onyx ember frost blaze storm titan nova comet
  shadow jackal panther hydra phoenix wraith zenith vortex bandit cipher rogue sentinel`.trim().split(/\s+/);
