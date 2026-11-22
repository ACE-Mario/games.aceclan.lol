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
    words: `aatrox ahri akali akshan alistar ambessa amumu anivia annie aphelios ashe aurora azir bard
      blitzcrank brand braum briar caitlyn camille cassiopeia corki darius diana draven ekko elise evelynn
      ezreal fiddlesticks fiora fizz galio gangplank garen gnar gragas graves gwen hecarim heimerdinger hwei
      illaoi irelia ivern janna jax jayce jhin jinx kalista karma karthus kassadin katarina kayle kayn kennen
      kindred kled leblanc leona lillia lissandra lucian lulu lux malphite malzahar maokai mel milio
      mordekaiser morgana naafiri nami nasus nautilus neeko nidalee nilah nocturne nunu olaf orianna ornn
      pantheon poppy pyke qiyana quinn rakan rammus rell renata renekton rengar riven rumble ryze samira
      sejuani senna seraphine sett shaco shen shyvana singed sion sivir skarner smolder sona soraka swain
      sylas syndra taliyah talon taric teemo thresh tristana trundle tryndamere twitch udyr urgot varus vayne
      veigar vex vi viego viktor vladimir volibear warwick wukong xayah xerath yasuo yone yorick yunara yuumi
      zac zed zeri ziggs zilean zoe zyra`
  },
  valorant: {
    name: "VALORANT",
    words: `astra breach brimstone chamber clove cypher deadlock fade gekko harbor iso jett kayo killjoy
      neon omen phoenix raze reyna sage skye sova tejo veto viper vyse waylay yoru`
  }
};

// Words used to make game codes like FALCON-42.
window.CODE_WORDS = `falcon viper cobra raven ghost onyx ember frost blaze storm titan nova comet
  shadow jackal panther hydra phoenix wraith zenith vortex bandit cipher rogue sentinel`.trim().split(/\s+/);
