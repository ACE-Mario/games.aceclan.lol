// Question packs for Clan Trivia. The game server reads this file too, so edit questions only here
// (then restart the game server so online rooms pick up the change).
//
// One question per line:   Question? | Right answer | Wrong answer | Wrong answer | Wrong answer
// The right answer always goes first; the game shuffles the order. 2 to 4 answers per question.
// Lines starting with # are ignored. Don't use the | or ` characters inside a question.
// Add a pack by copying a block: a short id, a name, and the questions between the ` marks.
window.TRIVIA_PACKS = {
  general: { name: "General knowledge", questions: `
    What is the capital of Australia? | Canberra | Sydney | Melbourne | Perth
    Which planet is known as the Red Planet? | Mars | Venus | Jupiter | Mercury
    How many continents are there? | 7 | 5 | 6 | 8
    What is the largest ocean on Earth? | Pacific | Atlantic | Indian | Arctic
    Which gas do plants take in from the air to make food? | Carbon dioxide | Oxygen | Nitrogen | Helium
    Who painted the Mona Lisa? | Leonardo da Vinci | Michelangelo | Raphael | Vincent van Gogh
    What is the chemical symbol for gold? | Au | Ag | Gd | Go
    How many sides does a hexagon have? | 6 | 5 | 7 | 8
    What is the hardest natural substance? | Diamond | Quartz | Iron | Granite
    What is the smallest prime number? | 2 | 1 | 3 | 0
    Which country gave the Statue of Liberty to the USA? | France | Britain | Spain | Italy
    At sea level, water boils at how many degrees Celsius? | 100 | 90 | 110 | 120
    How many minutes are in a day? | 1440 | 1240 | 1400 | 1600
    What is the largest mammal? | Blue whale | African elephant | Giraffe | Sperm whale
    In which year did the Titanic sink? | 1912 | 1905 | 1918 | 1923
    What is the square root of 144? | 12 | 14 | 11 | 16
    What is the main ingredient in guacamole? | Avocado | Tomato | Peas | Cucumber
    Which planet has the biggest, brightest rings? | Saturn | Jupiter | Uranus | Neptune
    How many players does a football (soccer) team have on the pitch? | 11 | 10 | 9 | 12
    Who wrote Romeo and Juliet? | William Shakespeare | Charles Dickens | Jane Austen | Mark Twain
    Water freezes at how many degrees Fahrenheit? | 32 | 0 | 16 | 40
    What is the capital of Japan? | Tokyo | Kyoto | Osaka | Hiroshima
    How many bones are in the adult human body? | 206 | 186 | 226 | 256
    What is the tallest mountain above sea level? | Mount Everest | K2 | Kilimanjaro | Mont Blanc
    Which organ pumps blood around the body? | Heart | Liver | Lungs | Kidneys
    What is 7 times 8? | 56 | 54 | 48 | 64
    What colour do you get by mixing blue and yellow paint? | Green | Purple | Orange | Brown
    What is the capital of Canada? | Ottawa | Toronto | Vancouver | Montreal
    Who was the first person to walk on the Moon? | Neil Armstrong | Buzz Aldrin | Yuri Gagarin | Michael Collins
    What is the largest planet in our solar system? | Jupiter | Saturn | Neptune | Earth
    What is the currency of Japan? | Yen | Won | Yuan | Ringgit
    How many hearts does an octopus have? | 3 | 1 | 2 | 8
    What is the largest hot desert in the world? | Sahara | Gobi | Kalahari | Arabian
    What is the capital of Italy? | Rome | Milan | Venice | Naples
    How many legs does a spider have? | 8 | 6 | 10 | 12
    What does www stand for in web addresses? | World Wide Web | Wide World Web | Web World Wide | World Web Wire
    Which metal is liquid at room temperature? | Mercury | Lead | Tin | Aluminium
    What is the largest country by area? | Russia | Canada | China | United States
    How many strings does a standard guitar have? | 6 | 4 | 5 | 7
    Roughly how fast does light travel? | 300,000 km a second | 30,000 km a second | 3,000 km a second | 3 million km a second
    Who came up with the theory of relativity? | Albert Einstein | Isaac Newton | Nikola Tesla | Stephen Hawking
    Which ocean lies between Africa and Australia? | Indian | Atlantic | Pacific | Southern
    How many days are in a leap year? | 366 | 365 | 364 | 360
    What is the capital of Egypt? | Cairo | Alexandria | Giza | Luxor
    Which bird is a common symbol of peace? | Dove | Eagle | Owl | Swan
    What is the largest organ of the human body? | Skin | Liver | Brain | Lungs
    Kangaroos are native to which country? | Australia | New Zealand | South Africa | Brazil
    In computing, what does CPU stand for? | Central Processing Unit | Computer Power Unit | Central Program Utility | Core Processing Unit
    What is the capital of Spain? | Madrid | Barcelona | Seville | Valencia
    How many degrees are in a right angle? | 90 | 45 | 180 | 100
    Which planet is closest to the Sun? | Mercury | Venus | Mars | Earth
    Who described the laws of motion and universal gravitation in 1687? | Isaac Newton | Galileo Galilei | Albert Einstein | Charles Darwin
    What is the national animal of Scotland? | Unicorn | Lion | Red deer | Golden eagle
    How many colours are traditionally named in a rainbow? | 7 | 6 | 5 | 8
    Which blood type is known as the universal donor? | O negative | AB positive | A negative | B positive
    What is the capital of Germany? | Berlin | Munich | Frankfurt | Hamburg
    How many sides does an octagon have? | 8 | 6 | 10 | 12
    Which famous ship's captain hunted the white whale Moby Dick? | Captain Ahab | Captain Hook | Captain Nemo | Captain Flint
    How many hours are in a week? | 168 | 144 | 172 | 186
    Which country invented pizza as we know it today? | Italy | Greece | France | USA
  ` },

  clan: { name: "Clan & gaming", questions: `
    # Add your own clan questions here, one per line. Right answer first.
    Where does ACE Clan play its party games online? | games.aceclan.lol | play.aceclan.lol | hypixel.aceclan.lol | aceclan.gg
    Which ACE game has spymasters giving one-word clues? | Ace Agents | Clan Trivia | Snakes & Ladders | Ace Poker Night
    In Minecraft, what block do you need to build a Nether portal frame? | Obsidian | Cobblestone | Netherrack | Bedrock
    In Minecraft, which green mob sneaks up and explodes? | Creeper | Zombie | Skeleton | Enderman
    In Minecraft, how many obsidian blocks make the smallest Nether portal frame without corners? | 10 | 8 | 12 | 14
    In Minecraft, what do you give a wolf to tame it? | Bones | Fish | Wheat | Carrots
    In Minecraft, what is the dimension with the Ender Dragon called? | The End | The Nether | The Void | The Deep Dark
    In Minecraft, what is the weakest pickaxe that can mine diamond ore and drop diamonds? | Iron | Stone | Wood | Gold
    In Bed Wars, what does your team have to protect? | Its bed | Its flag | Its crystal | Its chest
    Which company makes the PlayStation consoles? | Sony | Microsoft | Nintendo | Sega
    Which company makes Fortnite? | Epic Games | Riot Games | Valve | Blizzard
    Which company makes League of Legends and Valorant? | Riot Games | Valve | Blizzard | Epic Games
    In Valorant, how many players are on each team? | 5 | 4 | 6 | 3
    In Valorant, how many rounds do you need to win a standard match before overtime? | 13 | 12 | 16 | 15
    In Valorant, what is the bomb-like device called? | Spike | Core | Charge | Orb
    What colour is Mario's cap? | Red | Green | Blue | Yellow
    What does GG mean in game chat? | Good game | Get going | Great goal | Go green
    What does AFK stand for? | Away from keyboard | Always fighting kills | Aim for kills | Another free kill
    What does NPC stand for? | Non-player character | New player challenge | Next power cycle | No player control
    Which console is made by Nintendo? | Switch | Xbox | PlayStation | Steam Deck
    Who is the green-clad hero of The Legend of Zelda games? | Link | Zelda | Ganon | Navi
    What is the name of Valve's PC game store? | Steam | Origin | Uplay | Battle.net
    In Among Us, what are the saboteurs called? | Impostors | Traitors | Spies | Agents
    Which battle royale drops players from a flying Battle Bus? | Fortnite | Apex Legends | PUBG | Warzone
    What is the in-game currency of Fortnite called? | V-Bucks | Robux | Coins | Gems
    What is the in-game currency of Roblox called? | Robux | V-Bucks | Diamonds | Credits
    In Pokémon, which of these types is super effective against Water? | Electric | Fire | Rock | Ground
    How many ghosts chase Pac-Man in the original arcade game? | 4 | 3 | 5 | 6
    In chess, which piece only ever moves diagonally? | Bishop | Rook | Knight | King
    Which game is the best-selling video game of all time? | Minecraft | Tetris | Grand Theft Auto V | Wii Sports
  ` },
};
