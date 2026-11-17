"""Games the live server can host. Add a new game by writing a module like agents.py
(new_state, default_seat, handle, view) and listing it here. Seated turn-based games can
build on base.SeatedGame, which already handles the lobby, seats and admin panel."""
from .agents import Agents
from .canasta import Canasta
from .mansion import Mansion
from .poker import Poker
from .snakes import Snakes
from .trivia import Trivia

GAMES = {g.id: g for g in (Agents(), Snakes(), Trivia(), Poker(), Canasta(), Mansion())}
