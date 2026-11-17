"""Games the live server can host. Add a new game by writing a module like agents.py
(new_state, default_seat, handle, view) and listing it here."""
from .agents import Agents

GAMES = {g.id: g for g in (Agents(),)}
