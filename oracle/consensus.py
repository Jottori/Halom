from typing import Dict, List, Optional, Tuple
import numpy as np
from datetime import datetime
from .config.decentralization import DecentralizationConfig, OracleNodeConfig

class KonszenzusManager:
    """Konszenzus kezelő osztály"""
    
    def __init__(self, config: DecentralizationConfig):
        self.config = config
        self.utolsó_értékek: Dict[str, Tuple[float, datetime]] = {}
        
    def súlyozott_átlag_számítás(self, értékek: Dict[str, float]) -> Optional[float]:
        """Súlyozott átlag számítása a node-ok reputációja alapján"""
        if not értékek:
            return None
            
        összsúly = 0
        súlyozott_összeg = 0
        
        for node_id, érték in értékek.items():
            if node_id in self.config.nodes:
                súly = self.config.nodes[node_id].reputation
                súlyozott_összeg += érték * súly
                összsúly += súly
                
        return súlyozott_összeg / összsúly if összsúly > 0 else None
        
    def érték_validálás(self, node_id: str, érték: float) -> bool:
        """Beérkező érték validálása"""
        if node_id not in self.config.nodes:
            return False
            
        node_config = self.config.nodes[node_id]
        
        # Ellenőrizzük az eltérést az utolsó ismert értékektől
        if self.utolsó_értékek:
            átlag = np.mean([v[0] for v in self.utolsó_értékek.values()])
            eltérés = abs(érték - átlag) / átlag * 100
            
            if eltérés > node_config.max_eltérés_százalék:
                return False
                
        return True
        
    def konszenzus_elérés(self, új_értékek: Dict[str, float]) -> Optional[float]:
        """Konszenzus elérésének megkísérlése"""
        if len(új_értékek) < self.config.consensus.min_node_szám:
            return None
            
        # Validált értékek szűrése
        validált_értékek = {
            node_id: érték 
            for node_id, érték in új_értékek.items()
            if self.érték_validálás(node_id, érték)
        }
        
        if len(validált_értékek) < self.config.consensus.min_node_szám:
            return None
            
        # Konszenzus érték számítása
        if self.config.consensus.súlyozott_szavazás:
            konszenzus_érték = self.súlyozott_átlag_számítás(validált_értékek)
        else:
            konszenzus_érték = np.median(list(validált_értékek.values()))
            
        # Értékek frissítése
        most = datetime.now()
        self.utolsó_értékek = {
            node_id: (érték, most)
            for node_id, érték in validált_értékek.items()
        }
        
        return konszenzus_érték
        
    def reputáció_frissítés(self, node_id: str, siker: bool):
        """Node reputációjának frissítése"""
        if node_id not in self.config.nodes:
            return
            
        node = self.config.nodes[node_id]
        if siker:
            node.reputation = min(node.reputation + 1, 100)
        else:
            node.reputation = max(node.reputation - 5, 0) 