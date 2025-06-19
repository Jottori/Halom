import pytest
from datetime import datetime, timedelta
from ..consensus import KonszenzusManager
from ..config.decentralization import DecentralizationConfig, ConsensusConfig, OracleNodeConfig

@pytest.fixture
def alap_konfig():
    return DecentralizationConfig(
        nodes={
            "node1": OracleNodeConfig(node_id="node1"),
            "node2": OracleNodeConfig(node_id="node2"),
            "node3": OracleNodeConfig(node_id="node3"),
        },
        consensus=ConsensusConfig(
            min_node_szám=2,
            max_eltérés_threshold=10.0,
            súlyozott_szavazás=True
        ),
        frissítési_intervallum=300
    )

@pytest.fixture
def konszenzus_manager(alap_konfig):
    return KonszenzusManager(alap_konfig)

def test_súlyozott_átlag_számítás(konszenzus_manager):
    értékek = {
        "node1": 100.0,
        "node2": 110.0,
        "node3": 105.0
    }
    
    # Minden node egyenlő reputációval (100) kezd
    eredmény = konszenzus_manager.súlyozott_átlag_számítás(értékek)
    assert abs(eredmény - 105.0) < 0.01

def test_érték_validálás(konszenzus_manager):
    # Első érték mindig érvényes
    assert konszenzus_manager.érték_validálás("node1", 100.0)
    
    # Töltsük fel néhány értékkel
    konszenzus_manager.utolsó_értékek = {
        "node1": (100.0, datetime.now()),
        "node2": (102.0, datetime.now()),
    }
    
    # Túl nagy eltérés nem érvényes
    assert not konszenzus_manager.érték_validálás("node3", 150.0)
    
    # Elfogadható eltérés érvényes
    assert konszenzus_manager.érték_validálás("node3", 103.0)

def test_konszenzus_elérés(konszenzus_manager):
    új_értékek = {
        "node1": 100.0,
        "node2": 102.0,
        "node3": 101.0
    }
    
    eredmény = konszenzus_manager.konszenzus_elérés(új_értékek)
    assert eredmény is not None
    assert abs(eredmény - 101.0) < 0.01
    
    # Kevés node esetén nincs konszenzus
    kevés_érték = {
        "node1": 100.0
    }
    assert konszenzus_manager.konszenzus_elérés(kevés_érték) is None

def test_reputáció_frissítés(konszenzus_manager):
    # Sikeres eset
    konszenzus_manager.reputáció_frissítés("node1", True)
    assert konszenzus_manager.config.nodes["node1"].reputation == 100  # Max érték
    
    # Sikertelen eset
    konszenzus_manager.reputáció_frissítés("node1", False)
    assert konszenzus_manager.config.nodes["node1"].reputation == 95  # Csökkent 5-tel
    
    # Nem létező node
    konszenzus_manager.reputáció_frissítés("nemlétező", True)  # Nem dob hibát
    
def test_extrém_esetek(konszenzus_manager):
    # Üres értékek kezelése
    assert konszenzus_manager.konszenzus_elérés({}) is None
    
    # Minden érték érvénytelen
    érvénytelen_értékek = {
        "node1": 1000.0,  # Túl magas
        "node2": -100.0,  # Túl alacsony
        "node3": 500.0    # Túl magas
    }
    assert konszenzus_manager.konszenzus_elérés(érvénytelen_értékek) is None 