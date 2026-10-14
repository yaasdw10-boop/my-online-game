const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};
let monsters = {
    1: { id: 1, name: 'Poring', type: 'poring', x: 300, y: 300, hp: 30, maxHp: 30, level: 1, exp: 25 },
    2: { id: 2, name: 'Drops', type: 'drops', x: 600, y: 400, hp: 45, maxHp: 45, level: 2, exp: 40 },
    3: { id: 3, name: 'Lunatic', type: 'lunatic', x: 500, y: 200, hp: 60, maxHp: 60, level: 3, exp: 60 }
};

io.on('connection', (socket) => {
    console.log('ผู้เล่นเชื่อมต่อ:', socket.id);

    players[socket.id] = {
        id: socket.id,
        name: 'Hero_' + Math.floor(Math.random() * 1000),
        x: 400,
        y: 300,
        hp: 120,
        maxHp: 120,
        sp: 60,
        maxSp: 60,
        lvl: 1,
        exp: 0,
        maxExp: 100,
        job: 'Novice',
        stats: { str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5, statPoint: 0 },
        equipment: { head: null, costume: 'default' },
        inventory: [
            { id: 'hp_potion', name: 'Red Potion (ฟื้น HP 50)', count: 10, type: 'consumable' },
            { id: 'sp_potion', name: 'Blue Potion (ฟื้น SP 30)', count: 5, type: 'consumable' },
            { id: 'hat_bunny', name: '🐰 หมวกกระต่ายแฟชั่น', count: 1, type: 'costume', slot: 'head', sprite: 'bunny' }
        ]
    };

    socket.emit('currentPlayers', players);
    socket.emit('currentMonsters', monsters);
    socket.broadcast.emit('newPlayer', players[socket.id]);
    socket.emit('updateInventory', players[socket.id].inventory);

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('attackMonster', (data) => {
        let player = players[socket.id];
        let monster = monsters[data.monsterId];
        if (player && monster && monster.hp > 0) {
            let baseDmg = 12 + player.stats.str * 2.5;
            if (data.isSkill) baseDmg *= 1.8; // สกิลแรงขึ้น
            let damage = Math.floor(baseDmg);
            monster.hp -= damage;

            if (monster.hp <= 0) {
                monster.hp = 0;
                player.exp += monster.exp;
                
                let invItem = player.inventory.find(i => i.id === 'hp_potion');
                if (invItem) { invItem.count++; } else { player.inventory.push({ id: 'hp_potion', name: 'Red Potion', count: 1, type: 'consumable' }); }

                let leveledUp = false;
                if (player.exp >= player.maxExp) {
                    player.lvl++;
                    player.exp = 0;
                    player.maxExp = Math.floor(player.maxExp * 1.4);
                    player.maxHp += 30;
                    player.hp = player.maxHp;
                    player.maxSp += 15;
                    player.sp = player.maxSp;
                    player.stats.statPoint += 5;
                    leveledUp = true;
                }

                io.emit('monsterDead', { monsterId: data.monsterId, killerId: socket.id, exp: monster.exp, leveledUp: leveledUp, player: player });
                socket.emit('updateInventory', player.inventory);

                setTimeout(() => {
                    monster.hp = monster.maxHp;
                    monster.x = Math.random() * 700 + 150;
                    monster.y = Math.random() * 500 + 150;
                    io.emit('monsterRespawn', monster);
                }, 4000);
            } else {
                io.emit('monsterDamaged', { monsterId: data.monsterId, hp: monster.hp, damage: damage });
            }
        }
    });

    socket.on('equipItem', (itemId) => {
        let player = players[socket.id];
        if (!player) return;
        let item = player.inventory.find(i => i.id === itemId);
        if (item && item.type === 'costume') {
            player.equipment.head = player.equipment.head === item.sprite ? null : item.sprite;
            io.emit('playerEquipChanged', { id: socket.id, equipment: player.equipment });
            socket.emit('playerDataUpdated', player);
        }
    });

    socket.on('useItem', (itemId) => {
        let player = players[socket.id];
        if (!player) return;
        let item = player.inventory.find(i => i.id === itemId);
        if (item && item.count > 0) {
            if (itemId === 'hp_potion') {
                player.hp = Math.min(player.maxHp, player.hp + 50);
            } else if (itemId === 'sp_potion') {
                player.sp = Math.min(player.maxSp, player.sp + 30);
            }
            item.count--;
            if (item.count <= 0) {
                player.inventory = player.inventory.filter(i => i.id !== itemId);
            }
            socket.emit('updateInventory', player.inventory);
            socket.emit('playerDataUpdated', player);
        }
    });

    socket.on('upgradeStat', (statName) => {
        let p = players[socket.id];
        if (p && p.stats.statPoint > 0 && p.stats[statName] !== undefined) {
            p.stats[statName]++;
            p.stats.statPoint--;
            socket.emit('updateStatsData', p);
        }
    });

    socket.on('chatMessage', (msg) => {
        if (players[socket.id]) {
            io.emit('chatMessage', { name: players[socket.id].name, msg: msg });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('disconnectPlayer', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
