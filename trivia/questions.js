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

    # Geography
    What is the capital of France? | Paris | Lyon | Marseille | Nice
    What is the capital of Norway? | Oslo | Bergen | Stockholm | Helsinki
    What is the capital of Portugal? | Lisbon | Porto | Madrid | Faro
    What is the capital of Brazil? | Brasília | Rio de Janeiro | São Paulo | Salvador
    What is the capital of Argentina? | Buenos Aires | Córdoba | Santiago | Montevideo
    What is the capital of Turkey? | Ankara | Istanbul | Izmir | Antalya
    What is the capital of New Zealand? | Wellington | Auckland | Christchurch | Queenstown
    What is the capital of South Korea? | Seoul | Busan | Incheon | Pyongyang
    What is the capital of Ireland? | Dublin | Cork | Galway | Belfast
    What is the capital of Scotland? | Edinburgh | Glasgow | Aberdeen | Dundee
    What is the capital of Wales? | Cardiff | Swansea | Newport | Bangor
    What is the capital of Greece? | Athens | Thessaloniki | Sparta | Corinth
    What is the capital of the Netherlands? | Amsterdam | Rotterdam | The Hague | Utrecht
    What is the capital of Switzerland? | Bern | Zurich | Geneva | Basel
    What is the capital of Kenya? | Nairobi | Mombasa | Kampala | Addis Ababa
    What is the capital of India? | New Delhi | Mumbai | Kolkata | Bangalore
    What is the capital of Mexico? | Mexico City | Guadalajara | Cancún | Monterrey
    What is the capital of Poland? | Warsaw | Kraków | Gdańsk | Prague
    Which is the longest river in Europe? | Volga | Danube | Rhine | Thames
    Which is the longest river in the United Kingdom? | Severn | Thames | Trent | Tyne
    Which country has the most people? | India | China | United States | Indonesia
    Which is the smallest country in the world by area? | Vatican City | Monaco | San Marino | Malta
    Which is the largest island in the world? | Greenland | Australia | Borneo | Madagascar
    Mount Kilimanjaro is in which country? | Tanzania | Kenya | Uganda | Ethiopia
    The Great Barrier Reef lies off the coast of which country? | Australia | Indonesia | Philippines | Fiji
    Which country is shaped like a boot? | Italy | Greece | Chile | Portugal
    Which river flows through Paris? | Seine | Loire | Rhône | Thames
    Which river flows through London? | Thames | Severn | Mersey | Avon
    Which river flows through Egypt? | Nile | Congo | Niger | Zambezi
    The Andes mountain range is on which continent? | South America | Africa | Asia | Europe
    In which country would you find the ancient city of Machu Picchu? | Peru | Mexico | Bolivia | Chile
    In which city is the Colosseum? | Rome | Athens | Naples | Istanbul
    Which country has the most islands? | Sweden | Indonesia | Philippines | Japan
    Which US state is the largest by area? | Alaska | Texas | California | Montana
    Which ocean is the smallest? | Arctic | Indian | Southern | Atlantic
    Which country does the island of Sicily belong to? | Italy | Greece | Malta | Spain
    How many states are there in the USA? | 50 | 48 | 52 | 51
    What is the deepest point in the world's oceans? | Mariana Trench | Puerto Rico Trench | Java Trench | Tonga Trench
    Which line of latitude runs round the middle of the Earth? | Equator | Tropic of Cancer | Prime Meridian | Arctic Circle
    Which city is known as the Big Apple? | New York | Los Angeles | Chicago | Boston

    # Science and nature
    What is the chemical symbol for iron? | Fe | Ir | In | F
    What is the chemical symbol for sodium? | Na | So | Sd | S
    What is the chemical symbol for silver? | Ag | Si | Sv | Au
    What is the most common gas in the Earth's air? | Nitrogen | Oxygen | Carbon dioxide | Argon
    Which planet is the hottest in our solar system? | Venus | Mercury | Mars | Jupiter
    Which planet spins on its side? | Uranus | Neptune | Saturn | Mars
    How many planets are in our solar system? | 8 | 9 | 7 | 10
    What is the name of the galaxy we live in? | Milky Way | Andromeda | Whirlpool | Sombrero
    How long does light from the Sun take to reach Earth, roughly? | 8 minutes | 8 seconds | 1 hour | 1 day
    What force keeps us on the ground? | Gravity | Magnetism | Friction | Inertia
    What do bees make? | Honey | Silk | Wax paper | Milk
    What is the fastest land animal? | Cheetah | Lion | Pronghorn | Greyhound
    What is the tallest animal? | Giraffe | Elephant | Ostrich | Moose
    Which animal is known as the king of the jungle? | Lion | Tiger | Gorilla | Elephant
    How many legs does an insect have? | 6 | 8 | 4 | 10
    A baby kangaroo is called a what? | Joey | Cub | Kid | Pup
    A group of lions is called a what? | Pride | Pack | Herd | Flock
    What is a male duck called? | Drake | Gander | Cob | Buck
    Which bird can fly backwards? | Hummingbird | Swallow | Kingfisher | Sparrow
    What is the largest bird in the world? | Ostrich | Emu | Albatross | Condor
    Which mammal can truly fly? | Bat | Flying squirrel | Sugar glider | Flying lemur
    Spiders belong to which group of animals? | Arachnids | Insects | Crustaceans | Reptiles
    What do caterpillars turn into? | Butterflies or moths | Beetles | Dragonflies | Bees
    How many teeth does an adult human usually have? | 32 | 28 | 30 | 36
    Which part of the body has the smallest bone? | Ear | Toe | Finger | Nose
    Which vitamin does your skin make in sunlight? | Vitamin D | Vitamin C | Vitamin A | Vitamin B12
    Which organ cleans your blood and makes urine? | Kidneys | Liver | Lungs | Stomach
    What is the normal human body temperature in Celsius, roughly? | 37 | 35 | 39 | 40
    What does DNA carry? | Genetic information | Oxygen | Electricity | Hormones only
    What kind of animal is a Komodo dragon? | Lizard | Snake | Crocodile | Dinosaur
    Which gas do humans breathe out more of than they breathe in? | Carbon dioxide | Oxygen | Nitrogen | Hydrogen
    What is the centre of an atom called? | Nucleus | Electron | Proton shell | Core cloud
    What is the boiling point of water in Fahrenheit at sea level? | 212 | 100 | 180 | 220
    Which colour has the longest wavelength of visible light? | Red | Violet | Green | Blue
    What does a thermometer measure? | Temperature | Air pressure | Humidity | Wind speed
    What shape is a snowflake usually? | Six-sided | Four-sided | Eight-sided | Round
    Which planet has a moon called Titan? | Saturn | Jupiter | Neptune | Mars
    What is the Earth's natural satellite called? | The Moon | Phobos | Europa | Titan
    What is a scientist who studies rocks called? | Geologist | Biologist | Astronomer | Botanist

    # History
    In which year did World War II end? | 1945 | 1944 | 1946 | 1939
    In which year did World War I begin? | 1914 | 1912 | 1916 | 1918
    In which year did humans first land on the Moon? | 1969 | 1965 | 1972 | 1959
    In which year did the Berlin Wall fall? | 1989 | 1991 | 1985 | 1979
    Who was the first President of the United States? | George Washington | Abraham Lincoln | Thomas Jefferson | John Adams
    Which ancient people built the pyramids at Giza? | Egyptians | Romans | Greeks | Persians
    Who was the first person to travel into space? | Yuri Gagarin | Neil Armstrong | Alan Shepard | John Glenn
    Which ship carried the Pilgrims to America in 1620? | Mayflower | Endeavour | Santa Maria | Golden Hind
    Which empire was ruled by Julius Caesar? | Roman | Greek | Ottoman | Persian
    Who was the British prime minister for most of World War II? | Winston Churchill | Neville Chamberlain | Clement Attlee | Margaret Thatcher
    Which British queen reigned for 70 years? | Elizabeth II | Victoria | Elizabeth I | Anne
    Who is credited with inventing the telephone? | Alexander Graham Bell | Thomas Edison | Nikola Tesla | Guglielmo Marconi
    Who invented the World Wide Web? | Tim Berners-Lee | Bill Gates | Steve Jobs | Alan Turing
    Which famous wall was built across northern England by the Romans? | Hadrian's Wall | Offa's Dyke | The Antonine Wall | The Long Wall
    Who painted the ceiling of the Sistine Chapel? | Michelangelo | Leonardo da Vinci | Raphael | Botticelli
    In which country did the Olympic Games begin? | Greece | Italy | Egypt | France
    Who made the first successful powered aeroplane flight, in 1903? | The Wright brothers | The Montgolfier brothers | The Lumière brothers | The Grimm brothers
    Which civilisation built Machu Picchu? | Inca | Aztec | Maya | Olmec
    Who discovered penicillin? | Alexander Fleming | Louis Pasteur | Marie Curie | Joseph Lister
    Who was the first woman to win a Nobel Prize? | Marie Curie | Rosalind Franklin | Florence Nightingale | Ada Lovelace
    Who is often called the first computer programmer? | Ada Lovelace | Alan Turing | Grace Hopper | Charles Babbage

    # Maths and numbers
    What is 12 times 12? | 144 | 124 | 132 | 154
    What is 15% of 200? | 30 | 15 | 20 | 35
    How many seconds are in an hour? | 3600 | 360 | 6000 | 1200
    What is the next prime number after 7? | 11 | 9 | 13 | 10
    How many sides does a pentagon have? | 5 | 6 | 4 | 7
    What is the value of pi to two decimal places? | 3.14 | 3.41 | 3.12 | 3.16
    What is 2 to the power of 10? | 1024 | 1000 | 512 | 2048
    How many degrees are in a full circle? | 360 | 180 | 90 | 400
    What is the Roman numeral for 50? | L | C | D | X
    What is the Roman numeral for 100? | C | M | L | D
    How many zeros are in one million? | 6 | 5 | 7 | 9
    What is half of a quarter? | An eighth | A third | A sixth | A tenth
    How many centimetres are in a metre? | 100 | 10 | 1000 | 50
    How many grams are in a kilogram? | 1000 | 100 | 10 | 10,000
    What do the angles in a triangle add up to? | 180 degrees | 90 degrees | 360 degrees | 270 degrees
    How many weeks are in a year? | 52 | 48 | 50 | 56

    # Language, books and arts
    Who wrote Harry Potter? | J.K. Rowling | Roald Dahl | C.S. Lewis | J.R.R. Tolkien
    Who wrote The Lord of the Rings? | J.R.R. Tolkien | C.S. Lewis | George R.R. Martin | Terry Pratchett
    Who wrote Charlie and the Chocolate Factory? | Roald Dahl | Enid Blyton | David Walliams | Dr. Seuss
    Who wrote Pride and Prejudice? | Jane Austen | Charlotte Brontë | Emily Brontë | Mary Shelley
    Who wrote A Christmas Carol? | Charles Dickens | Lewis Carroll | Oscar Wilde | Thomas Hardy
    Who wrote Frankenstein? | Mary Shelley | Bram Stoker | Edgar Allan Poe | H.G. Wells
    In which book does a girl called Alice fall down a rabbit hole? | Alice's Adventures in Wonderland | The Wizard of Oz | Peter Pan | The Secret Garden
    Who painted The Starry Night? | Vincent van Gogh | Claude Monet | Pablo Picasso | Salvador Dalí
    How many letters are in the English alphabet? | 26 | 24 | 25 | 28
    What is the opposite of the word ancient? | Modern | Old | Antique | Historic
    How many strings does a violin usually have? | 4 | 5 | 6 | 3
    Which composer wrote the Moonlight Sonata? | Beethoven | Mozart | Bach | Chopin
    Which famous playwright wrote Hamlet? | William Shakespeare | Christopher Marlowe | Ben Jonson | Oscar Wilde
    What is a word that means the same as another word called? | Synonym | Antonym | Homophone | Acronym

    # Sport
    How many players are on a basketball team on the court? | 5 | 6 | 7 | 4
    How often are the Summer Olympic Games usually held? | Every 4 years | Every 2 years | Every 3 years | Every 5 years
    How many rings are on the Olympic flag? | 5 | 4 | 6 | 7
    In tennis, what is a score of zero called? | Love | Nil | Duck | Zero
    How many holes are played in a standard round of golf? | 18 | 9 | 12 | 20
    In which sport would you hit a shuttlecock? | Badminton | Squash | Table tennis | Tennis
    How long is a marathon, roughly? | 42 km | 26 km | 50 km | 32 km
    In snooker, which ball is worth the most points? | Black | Pink | Blue | Red
    How many players are on a rugby union team on the pitch? | 15 | 13 | 11 | 12
    Which country won the first football World Cup in 1930? | Uruguay | Brazil | Argentina | Italy
    In darts, what is the highest score with three darts? | 180 | 150 | 200 | 160
    How many points is a touchdown worth in American football? | 6 | 7 | 3 | 5
    What colour is the centre of an archery target? | Gold (yellow) | Red | Blue | Black
    In chess, which piece can jump over others? | Knight | Bishop | Rook | Queen

    # Food, everyday and miscellaneous
    Which fruit is known for keeping the doctor away? | Apple | Banana | Orange | Grape
    Sushi comes from which country? | Japan | China | Korea | Thailand
    Which nut is used to make marzipan? | Almond | Walnut | Cashew | Hazelnut
    What is the main ingredient of hummus? | Chickpeas | Lentils | Peas | Beans
    Which country is famous for maple syrup? | Canada | Norway | USA | Sweden
    Paella is a traditional dish from which country? | Spain | Italy | Mexico | Portugal
    What colour is a ripe banana? | Yellow | Green | Red | Orange
    Which vegetable is used to make chips? | Potato | Carrot | Parsnip | Turnip
    What is the main ingredient of bread? | Flour | Rice | Sugar | Oats
    How many pieces does each player start with in chess? | 16 | 12 | 20 | 18
    How many squares are on a chessboard? | 64 | 81 | 100 | 49
    How many cards are in a standard deck, without jokers? | 52 | 54 | 48 | 50
    How many dots are on a standard six-sided die in total? | 21 | 18 | 24 | 36
    What do you call a word that reads the same backwards, like level? | Palindrome | Anagram | Acronym | Homonym
    Which month has the fewest days? | February | April | June | November
    In which month is Halloween? | October | November | September | December
    How many months have 31 days? | 7 | 6 | 5 | 8
    Which is the first sign of the zodiac in the usual order? | Aries | Capricorn | Pisces | Leo
    What are the three primary colours of light? | Red, green and blue | Red, yellow and blue | Red, green and yellow | Cyan, magenta and yellow
    What does a compass needle point towards? | Magnetic north | The Sun | True south | The equator
    What does USB stand for? | Universal Serial Bus | United System Board | Universal Signal Bridge | User Service Bus
    In computing, what does RAM stand for? | Random Access Memory | Read And Modify | Rapid Access Module | Runtime Application Memory
    What is 1,024 megabytes? | 1 gigabyte | 1 terabyte | 1 kilobyte | 10 gigabytes
    Which company makes the iPhone? | Apple | Samsung | Google | Microsoft
    What does the abbreviation Wi-Fi let devices do? | Connect to a network wirelessly | Charge without a cable | Print in colour | Record sound
  ` },

  games: { name: "Video games", questions: `
    Which company created the Super Mario series? | Nintendo | Sega | Sony | Atari
    What is the name of Mario's brother? | Luigi | Wario | Toad | Yoshi
    Which princess does Mario usually rescue? | Peach | Daisy | Zelda | Rosalina
    What is the name of the spiky turtle king who fights Mario? | Bowser | Ganon | Wario | Kamek
    What is the name of Mario's green dinosaur friend? | Yoshi | Birdo | Rex | Dino
    In Super Mario games, which item makes Mario grow bigger? | Super Mushroom | Fire Flower | Super Star | 1-Up Mushroom
    In Mario Kart, which item chases down the racer in first place? | Spiny Shell | Red Shell | Banana | Bullet Bill
    Which company created Sonic the Hedgehog? | Sega | Nintendo | Capcom | Namco
    What does Sonic collect as he runs? | Gold rings | Coins | Stars | Gems
    What is the name of Sonic's two-tailed fox friend? | Tails | Knuckles | Shadow | Amy
    In Tetris, how many squares make up each falling piece? | 4 | 3 | 5 | 6
    In which country was Tetris first made? | Soviet Union | Japan | United States | United Kingdom
    Which Pokémon is number 1 in the National Pokédex? | Bulbasaur | Pikachu | Mew | Charmander
    What does Charmander evolve into first? | Charmeleon | Charizard | Dragonite | Ivysaur
    In Pokémon, which type is super effective against Grass? | Fire | Water | Ground | Electric
    Which game series stars the super soldier Master Chief? | Halo | Gears of War | Destiny | Call of Duty
    Which company makes the Xbox consoles? | Microsoft | Sony | Nintendo | Valve
    In which city is Grand Theft Auto V set? | Los Santos | Liberty City | Vice City | San Fierro
    Which game has you farming and making friends in Pelican Town? | Stardew Valley | Animal Crossing | Terraria | Harvest Moon
    In Animal Crossing, which tanuki sells you your island home? | Tom Nook | Isabelle | K.K. Slider | Blathers
    On which map is League of Legends usually played? | Summoner's Rift | Ascent | Dust II | Erangel
    Who is the Spartan warrior hero of the God of War series? | Kratos | Atreus | Ares | Zeus
    What is the name of the land in most Legend of Zelda games? | Hyrule | Termina | Tamriel | Azeroth
    Which game series is set in the world of Tamriel? | The Elder Scrolls | Fallout | The Witcher | Dragon Age
    Who is the monster-hunting hero of The Witcher games? | Geralt of Rivia | Ciri | Yennefer | Dandelion
    In which game series do survivors live in underground Vaults? | Fallout | Metro | BioShock | Borderlands
    In Rocket League, what do players drive while playing football? | Cars | Robots | Horses | Bikes
    Which 1972 Atari game, a simple bat-and-ball game, was the first big arcade hit? | Pong | Space Invaders | Asteroids | Breakout
    In which 1978 arcade game do rows of aliens march down the screen? | Space Invaders | Galaga | Asteroids | Defender
    In the original Donkey Kong arcade game, what does Donkey Kong throw? | Barrels | Bananas | Rocks | Coconuts
    What is the name of Nintendo's round pink hero who swallows enemies? | Kirby | Jigglypuff | Toad | Yoshi
    Which company publishes the Call of Duty games? | Activision | EA | Ubisoft | Valve
    In Fortnite, what is the shrinking danger zone called? | The Storm | The Gas | The Ring | The Fog
    In Portal, what is the name of the AI that runs the test chambers? | GLaDOS | HAL 9000 | SHODAN | Cortana
    In Portal, what treat are you promised at the end of the tests? | Cake | Pie | Ice cream | Cookies
    Which game series has the Animus, a machine for reliving ancestors' memories? | Assassin's Creed | Hitman | Dishonored | Far Cry
    Which company makes the Assassin's Creed games? | Ubisoft | EA | Activision | Square Enix
    Which fighting game series features Ryu and Chun-Li? | Street Fighter | Tekken | Mortal Kombat | Soulcalibur
    In which game do you play a goose causing trouble in a village? | Untitled Goose Game | Goat Simulator | Duck Game | Overcooked
    Which handheld console did Nintendo release in 1989? | Game Boy | Game Gear | Nintendo DS | Atari Lynx
    What does RPG stand for? | Role-playing game | Rapid play game | Real person game | Random points game
    In gaming, what does FPS stand for as a type of game? | First-person shooter | Fast player speed | Final power strike | Free play session
    What does MMO stand for? | Massively multiplayer online | Multi mode online | Many monsters online | Mega match online
    Which company makes the Resident Evil series? | Capcom | Konami | Square Enix | Sega
    In the Final Fantasy series, what are the big yellow birds you can ride? | Chocobos | Moogles | Cactuars | Tonberries
    In which game do you explore the underwater city of Rapture? | BioShock | Subnautica | Prey | Dead Space
    Which Nintendo console, released in 2006, brought in the motion-sensing Wii Remote? | Wii | GameCube | Switch | Nintendo 64
    Which company made the Half-Life games? | Valve | id Software | Bungie | Epic Games
    What is the name of the scientist hero of Half-Life? | Gordon Freeman | Isaac Clarke | Alyx Vance | Barney Calhoun
    Which game has you sneaking around as an agent known only as 47? | Hitman | Splinter Cell | Metal Gear Solid | Deus Ex
  ` },
  history: { name: "History", questions: `
    Who was the first emperor of Rome? | Augustus | Julius Caesar | Nero | Caligula
    In which year did Christopher Columbus first reach the Americas? | 1492 | 1488 | 1501 | 1520
    In which year was the Battle of Hastings? | 1066 | 1086 | 1016 | 1166
    Who won the Battle of Hastings? | William the Conqueror | Harold Godwinson | Edward the Confessor | Alfred the Great
    Which king of England had six wives? | Henry VIII | Henry VII | Edward VI | Richard III
    Which charter, sealed by King John in 1215, limited the king's power? | Magna Carta | Domesday Book | Bill of Rights | Act of Union
    In which year did the French Revolution begin? | 1789 | 1776 | 1799 | 1815
    Which French queen was executed during the French Revolution? | Marie Antoinette | Joséphine | Catherine de' Medici | Eleanor of Aquitaine
    Who was defeated at the Battle of Waterloo in 1815? | Napoleon Bonaparte | The Duke of Wellington | Louis XVI | Horatio Nelson
    In which year was the American Declaration of Independence adopted? | 1776 | 1789 | 1765 | 1812
    Who was the US president during the American Civil War? | Abraham Lincoln | Ulysses S. Grant | Andrew Johnson | James Buchanan
    Which plague killed around a third of Europe's people in the 1300s? | The Black Death | Smallpox | Cholera | Spanish flu
    Who led the Soviet Union during World War II? | Joseph Stalin | Vladimir Lenin | Nikita Khrushchev | Leon Trotsky
    Which Anglo-Saxon king of Wessex fought off the Vikings and is called the Great? | Alfred | Æthelred | Edward | Cnut
    Which ancient wonder was a giant statue at the harbour of Rhodes? | The Colossus | The Lighthouse | The Hanging Gardens | The Mausoleum
    Whose tomb did Howard Carter find in Egypt's Valley of the Kings in 1922? | Tutankhamun | Ramesses II | Khufu | Akhenaten
    Which queen of Egypt was allied with Julius Caesar and Mark Antony? | Cleopatra | Nefertiti | Hatshepsut | Nefertari
    Which Roman town was buried by the eruption of Mount Vesuvius in AD 79? | Pompeii | Ostia | Ravenna | Carthage
    Which Carthaginian general crossed the Alps with war elephants? | Hannibal | Hamilcar | Scipio | Spartacus
    Who founded the Mongol Empire? | Genghis Khan | Kublai Khan | Attila the Hun | Tamerlane
    Which Norse explorer is thought to have reached North America around the year 1000? | Leif Erikson | Erik the Red | Ragnar Lothbrok | Harald Hardrada
    In which year did the Great Fire of London happen? | 1666 | 1605 | 1688 | 1702
    What did Guy Fawkes and his plotters try to blow up in 1605? | The Houses of Parliament | The Tower of London | St Paul's Cathedral | Buckingham Palace
    Who was queen of England when the Spanish Armada was defeated in 1588? | Elizabeth I | Mary I | Victoria | Anne
    Which explorer led the first expedition to sail around the world, though he died on the way? | Ferdinand Magellan | Francis Drake | Vasco da Gama | James Cook
    Who was the first European to sail to India around the south of Africa? | Vasco da Gama | Christopher Columbus | Ferdinand Magellan | John Cabot
    Who brought printing with movable type to Europe around 1450? | Johannes Gutenberg | William Caxton | Martin Luther | Leonardo da Vinci
    Who started the Protestant Reformation in 1517? | Martin Luther | John Calvin | Henry VIII | Thomas Cranmer
    Whose assassination in 1914 sparked World War I? | Archduke Franz Ferdinand | Tsar Nicholas II | Kaiser Wilhelm II | King Edward VII
    Which country did Germany invade on 1 September 1939, starting World War II in Europe? | Poland | France | Belgium | Norway
    Which US naval base did Japan attack in December 1941? | Pearl Harbor | San Diego | Midway | Norfolk
    What was the code name for the Allied invasion of Normandy in 1944? | Operation Overlord | Operation Barbarossa | Operation Market Garden | Operation Sea Lion
    Who was the first woman to be UK prime minister? | Margaret Thatcher | Theresa May | Barbara Castle | Indira Gandhi
    Who led India's non-violent campaign for independence from Britain? | Mahatma Gandhi | Jawaharlal Nehru | Muhammad Ali Jinnah | Subhas Chandra Bose
    In which year did India gain independence? | 1947 | 1950 | 1939 | 1962
    Who was freed from prison in 1990 and became South Africa's president in 1994? | Nelson Mandela | Desmond Tutu | F. W. de Klerk | Thabo Mbeki
    Who gave the I Have a Dream speech in Washington in 1963? | Martin Luther King Jr. | Malcolm X | John F. Kennedy | Frederick Douglass
    Which people built the city of Tenochtitlan, where Mexico City is today? | Aztecs | Maya | Inca | Olmecs
    Which Spanish conquistador brought down the Aztec Empire? | Hernán Cortés | Francisco Pizarro | Juan Ponce de León | Hernando de Soto
    Under which Chinese dynasty was most of today's Great Wall built? | Ming | Qin | Han | Tang
    Which Chinese emperor was buried with the Terracotta Army? | Qin Shi Huang | Kublai Khan | Puyi | Wu of Han
    Which Macedonian king conquered the Persian Empire? | Alexander the Great | Philip II | Darius III | Leonidas
    Which Spartan king led the stand at Thermopylae in 480 BC? | Leonidas | Xerxes | Pericles | Themistocles
    Who was assassinated on the Ides of March in 44 BC? | Julius Caesar | Augustus | Mark Antony | Pompey
    What was the network of trade routes linking China with the Mediterranean called? | The Silk Road | The Amber Road | The Royal Road | The Salt Road
    In which country did the Industrial Revolution begin? | Great Britain | France | Germany | United States
    Which nurse was called the Lady with the Lamp in the Crimean War? | Florence Nightingale | Mary Seacole | Edith Cavell | Clara Barton
    What was the name of the first artificial satellite, launched in 1957? | Sputnik 1 | Vostok 1 | Explorer 1 | Luna 1
    In which year did the Soviet Union break up? | 1991 | 1989 | 1985 | 1995
    Which US president resigned after the Watergate scandal? | Richard Nixon | Gerald Ford | Lyndon B. Johnson | Jimmy Carter
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
