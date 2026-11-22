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
  league: {
    name: "League",
    words: `ahri akali alistar amumu annie ashe azir bard blitzcrank brand braum caitlyn camille corki
      darius diana draven ekko elise evelynn ezreal fiora fizz galio garen gnar gragas graves gwen hecarim
      heimer irelia ivern janna jax jayce jhin jinx karma karthus kassadin katarina kayle kayn kennen
      kindred kled leona lillia lissandra lucian lulu lux malphite maokai milio morgana nami nasus nautilus
      neeko nidalee nunu olaf orianna ornn pantheon poppy pyke qiyana quinn rakan rammus rell renekton
      rengar riven rumble ryze samira sejuani senna seraphine sett shaco shen shyvana singed sion sivir
      sona soraka swain sylas syndra taliyah talon taric teemo thresh tristana trundle tryndamere twitch
      udyr urgot varus vayne veigar vex vi viego viktor vladimir volibear warwick xayah yasuo yone yorick
      yuumi zac zed zeri ziggs zilean zoe zyra
      baron dragon herald grubs nexus inhibitor turret minion jungle gank lane mid top bot support carry
      ward flash ignite smite teleport exhaust barrier cleanse ghost recall shop gold blue red krugs
      gromp raptors wolves scuttle brush river elder soul baron rift aram poro penta quadra ace feed
      backdoor dive kite poke roam split freeze shove tower ult shutdown bounty`
  },
  valorant: {
    name: "VALORANT",
    words: `astra breach brimstone chamber clove cypher deadlock fade gekko harbor iso jett kayo killjoy
      neon omen phoenix raze reyna sage skye sova tejo viper vyse waylay yoru
      ascent bind breeze fracture haven icebox lotus pearl split sunset abyss corrode
      classic shorty frenzy ghost sheriff stinger spectre bucky judge bulldog guardian phantom vandal
      marshal outlaw operator ares odin knife
      spike plant defuse attack defend duelist initiator controller sentinel ultimate orb credits eco
      force bonus pistol overtime clutch ace entry lurk rotate retake flank site mid heaven hell garage
      smoke flash wall stun recon drone trap turret wingman alarmbot nanoswarm tripwire dash updraft
      blast orbs rank radiant immortal ascendant diamond platinum gold silver bronze iron headshot spray
      tap peek jiggle crosshair armor shield wallbang ping thrifty flawless deathmatch swiftplay
      spikerush escalation premier`
  }
};

// Words used to make game codes like FALCON-42.
window.CODE_WORDS = `falcon viper cobra raven ghost onyx ember frost blaze storm titan nova comet
  shadow jackal panther hydra phoenix wraith zenith vortex bandit cipher rogue sentinel`.trim().split(/\s+/);
