from typing import Dict, List, Optional
from pydantic import BaseModel
from datetime import datetime

class OracleNodeConfig(BaseModel):
    """Oracle node konfigurációs osztály"""
    node_id: str
    reputation: int = 100  # Kezdeti reputáció
    min_válaszidő_ms: int = 1000
    max_eltérés_százalék: float = 5.0
    
class ConsensusConfig(BaseModel):
    """Konszenzus beállítások"""
    min_node_szám: int = 3
    max_eltérés_threshold: float = 10.0
    súlyozott_szavazás: bool = True
    
class DecentralizationConfig(BaseModel):
    """Fő decentralizációs konfiguráció"""
    nodes: Dict[str, OracleNodeConfig]
    consensus: ConsensusConfig
    frissítési_intervallum: int = 300  # másodpercben
    
    class Config:
        arbitrary_types_allowed = True 