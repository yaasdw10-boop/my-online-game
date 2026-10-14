let globalSocket = null;
let myPlayerData = null;
let selectedTarget = null;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    let now = audioCtx.currentTime;
    if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
    } else if (type === 'skill') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(750, now + 0.25);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
    } else if (type === 'levelup') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.setValueAtTime(750, now + 0.1);
        osc.frequency.setValueAtTime(1200, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.45);
        osc.start(now); osc.stop(now + 0.45);
    }
}

class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    preload() {
        this.load.image('bg', 'https://labs.phaser.io/assets/skies/deep-blue.png');
    }

    create() {
        // ฉากทุ่งหญ้าธรรมชาติ
        this.add.tileSprite(0, 0, 6000, 6000, 'bg').setTint(0x1a4314).setAlpha(0.92);

        this.socket = io();
        globalSocket = this.socket;

        this.otherPlayers = this.physics.add.group();
        this.monstersGroup = this.physics.add.group();
        this.moveDir = { x: 0, y: 0 };
        this.cameras.main.setZoom(1.5);

        this.socket.on('currentPlayers', (players) => {
            Object.keys(players).forEach(id => {
                if (id === this.socket.id) {
                    myPlayerData = players[id];
                    this.addPlayer(players[id]);
                    updateUI();
                } else {
                    this.addOther(players[id]);
                }
            });
        });

        this.socket.on('currentMonsters', (monsters) => {
            Object.keys(monsters).forEach(id => this.addMonster(monsters[id]));
        });

        this.socket.on('newPlayer', (p) => this.addOther(p));
        this.socket.on('disconnectPlayer', (id) => {
            this.otherPlayers.getChildren().forEach(o => {
                if (o.playerId === id) {
                    if (o.shadow) o.shadow.destroy();
                    o.destroy();
                }
            });
        });

        this.socket.on('playerMoved', (p) => {
            this.otherPlayers.getChildren().forEach(o => {
                if (o.playerId === p.id) {
                    o.setPosition(p.x, p.y);
                    if (o.shadow) o.shadow.setPosition(p.x, p.y + 18);
                    if (o.nameText) o.nameText.setPosition(p.x, p.y - 42);
                }
            });
        });

        this.socket.on('updateStatsData', (p) => { myPlayerData = p; updateUI(); });
        this.socket.on('playerDataUpdated', (p) => { myPlayerData = p; updateUI(); });
        this.socket.on('updateInventory', (inv) => { if (myPlayerData) myPlayerData.inventory = inv; updateInventoryUI(); });

        this.socket.on('monsterDamaged', (data) => {
            playSound('hit');
            this.monstersGroup.getChildren().forEach(m => {
                if (m.monsterId === data.monsterId) {
                    showFloatingText(m.x, m.y - 20, `-${data.damage}`, '#ef4444', '14px');
                    // เอฟเฟกต์แฟลชกระพริบและสั่นเมื่อโดนตี
                    this.tweens.add({ targets: m, alpha: 0.2, scale: 1.15, duration: 60, yoyo: true, repeat: 1 });
                }
            });
        });

        this.socket.on('monsterDead', (data) => {
            this.monstersGroup.getChildren().forEach(m => {
                if (m.monsterId === data.monsterId) {
                    showFloatingText(m.x, m.y - 25, `+${data.exp} EXP`, '#34d399', '13px');
                    if (selectedTarget && selectedTarget.monsterId === data.monsterId) { clearTarget(); }
                    m.destroy();
                }
            });
            if (data.killerId === this.socket.id) {
                myPlayerData = data.player;
                if (data.leveledUp) {
                    playSound('levelup');
                    showFloatingText(this.ship.x, this.ship.y - 65, '⭐ LEVEL UP! ⭐', '#fde047', '16px');
                    this.triggerLevelUpFX(this.ship.x, this.ship.y);
                }
                updateUI();
            }
        });

        this.socket.on('monsterRespawn', (m) => this.addMonster(m));

        this.socket.on('chatMessage', (data) => {
            let box = document.getElementById('chat-box');
            box.innerHTML += `<div><b>${data.name}:</b> ${data.msg}</div>`;
            box.scrollTop = box.scrollHeight;
        });

        // Joystick ควบคุมการเคลื่อนไหว
        let joy = document.getElementById('joystick'), knob = document.getElementById('knob');
        let active = false, maxD = 35;

        joy.onpointerdown = () => { active = true; };
        window.onpointermove = (e) => {
            if (!active) return;
            let rect = joy.getBoundingClientRect();
            let dx = e.clientX - (rect.left + rect.width / 2);
            let dy = e.clientY - (rect.top + rect.height / 2);
            let dist = Math.hypot(dx, dy);
            if (dist > maxD) { dx = (dx/dist)*maxD; dy = (dy/dist)*maxD; }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            this.moveDir.x = dx / maxD;
            this.moveDir.y = dy / maxD;
        };
        window.onpointerup = () => {
            active = false;
            knob.style.transform = `translate(0px, 0px)`;
            this.moveDir.x = 0; this.moveDir.y = 0;
        };
    }

    addPlayer(p) {
        this.shipShadow = this.add.ellipse(p.x, p.y + 18, 24, 10, 0x000000, 0.55);
        this.ship = this.add.container(p.x, p.y);
        
        let cape = this.add.rectangle(0, 6, 20, 22, 0x2563eb);
        let body = this.add.rectangle(0, 4, 18, 20, 0x3b82f6);
        let armorPlate = this.add.rectangle(0, 0, 14, 12, 0x93c5fd);
        let head = this.add.circle(0, -14, 10, 0xffdead).setStrokeStyle(1, 0xb45309);
        let hair = this.add.rectangle(0, -22, 14, 8, 0x78350f, 1);
        let eyeLeft = this.add.rectangle(-3, -14, 2, 3, 0x000000);
        let eyeRight = this.add.rectangle(3, -14, 2, 3, 0x000000);
        let sword = this.add.rectangle(12, 2, 3, 15, 0xf8fafc).setAngle(15);

        this.ship.add([cape, body, armorPlate, head, hair, eyeLeft, eyeRight, sword]);
        this.physics.world.enable(this.ship);
        this.ship.body.setCollideWorldBounds(true);
        this.ship.body.setSize(20, 30);

        this.cameras.main.startFollow(this.ship, true, 0.1, 0.1);
        this.nameText = this.add.text(p.x, p.y - 42, `${p.name} (You)`, { fontSize: '10px', fill: '#fde047', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    }

    addOther(p) {
        let shadow = this.add.ellipse(p.x, p.y + 18, 24, 10, 0x000000, 0.55);
        let o = this.add.container(p.x, p.y);
        
        let cape = this.add.rectangle(0, 6, 20, 22, 0x059669);
        let body = this.add.rectangle(0, 4, 18, 20, 0x10b981);
        let armorPlate = this.add.rectangle(0, 0, 14, 12, 0x6ee7b7);
        let head = this.add.circle(0, -14, 10, 0xffdead).setStrokeStyle(1, 0xb45309);
        let hair = this.add.rectangle(0, -22, 14, 8, 0x111827, 1);
        let eyeLeft = this.add.rectangle(-3, -14, 2, 3, 0x000000);
        let eyeRight = this.add.rectangle(3, -14, 2, 3, 0x000000);

        o.add([cape, body, armorPlate, head, hair, eyeLeft, eyeRight]);
        o.playerId = p.id;
        o.shadow = shadow;
        this.otherPlayers.add(o);
        o.nameText = this.add.text(p.x, p.y - 42, p.name, { fontSize: '9px', fill: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    }

    addMonster(m) {
        let monsterSprite = this.add.container(m.x, m.y);
        let color = m.type === 'drops' ? 0x3b82f6 : (m.type === 'lunatic' ? 0xf8fafc : 0xec4899);
        let body = this.add.circle(0, 0, 16, color).setStrokeStyle(2, 0xffffff);
        let eye1 = this.add.circle(-4, -3, 2, 0x000000);
        let eye2 = this.add.circle(4, -3, 2, 0x000000);
        let mouth = this.add.circle(0, 2, 1.5, 0x000000);
        monsterSprite.add([body, eye1, eye2, mouth]);

        monsterSprite.monsterId = m.id;
        this.physics.world.enable(monsterSprite);
        monsterSprite.body.setCircle(16, -16, -16);
        monsterSprite.setInteractive(new Phaser.Geom.Circle(0, 0, 18), Phaser.Geom.Circle.Contains);
        
        monsterSprite.on('pointerdown', () => {
            selectedTarget = monsterSprite;
            document.getElementById('target-hud').style.display = 'block';
            document.getElementById('target-name').innerText = `${m.name} [Lv.${m.level}]`;
        });

        this.monstersGroup.add(monsterSprite);
        this.add.text(m.x, m.y - 25, `${m.name} [Lv.${m.level}]`, { fontSize: '9px', fill: '#fca5a5', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5);
    }

    doAttack(isSkill = false) {
        if (this.ship) {
            // อニメชันพุ่งตัวโจมตี
            this.tweens.add({ targets: this.ship, scaleX: 1.3, scaleY: 0.7, duration: 60, yoyo: true });
            
            if (isSkill) {
                playSound('skill');
                this.triggerSkillEffect(this.ship.x, this.ship.y);
            } else {
                playSound('hit');
                this.triggerHitFX(this.ship.x, this.ship.y);
            }

            if (selectedTarget && selectedTarget.active) {
                let dist = Phaser.Math.Distance.Between(this.ship.x, this.ship.y, selectedTarget.x, selectedTarget.y);
                if (dist <= 130 && globalSocket) {
                    globalSocket.emit('attackMonster', { monsterId: selectedTarget.monsterId, isSkill: isSkill });
                } else {
                    showFloatingText(this.ship.x, this.ship.y - 50, 'เป้าหมายไกลเกินไป!', '#fde047', '11px');
                }
            } else {
                let nearestMonster = null;
                let minDist = 110;
                this.monstersGroup.getChildren().forEach(m => {
                    let dist = Phaser.Math.Distance.Between(this.ship.x, this.ship.y, m.x, m.y);
                    if (dist < minDist) { minDist = dist; nearestMonster = m; }
                });
                if (nearestMonster && globalSocket) {
                    globalSocket.emit('attackMonster', { monsterId: nearestMonster.monsterId, isSkill: isSkill });
                }
            }
        }
    }

    // เอฟเฟกต์ประกายแสงสกิลเวทมนตร์ / Bash สุดอลังการ
    triggerSkillEffect(x, y) {
        let ring = this.add.circle(x, y, 10, 0x38bdf8, 0.8).setStrokeStyle(3, 0xffffff);
        let star = this.add.text(x, y - 15, '✨ BASH! ✨', { fontSize: '13px', fill: '#38bdf8', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
        
        this.tweens.add({
            targets: ring,
            scale: 4,
            alpha: 0,
            duration: 350,
            onComplete: () => ring.destroy()
        });
        this.tweens.add({
            targets: star,
            y: y - 45,
            alpha: 0,
            duration: 600,
            onComplete: () => star.destroy()
        });
    }

    // เอฟเฟกต์ประกายดาบฟันปกติ
    triggerHitFX(x, y) {
        let slash = this.add.text(x + 10, y, '⚡', { fontSize: '14px' }).setOrigin(0.5);
        this.tweens.add({
            targets: slash,
            x: x + 25,
            y: y - 15,
            alpha: 0,
            duration: 250,
            onComplete: () => slash.destroy()
        });
    }

    // เอฟเฟกต์เลเวลอัพเปล่งแสง
    triggerLevelUpFX(x, y) {
        let beam = this.add.rectangle(x, y, 40, 100, 0xfde047, 0.6);
        this.tweens.add({
            targets: beam,
            scaleY: 2,
            alpha: 0,
            duration: 800,
            onComplete: () => beam.destroy()
        });
    }

    update() {
        if (this.ship && this.ship.body) {
            let speed = 195;
            this.ship.body.setVelocity(this.moveDir.x * speed, this.moveDir.y * speed);

            if (this.shipShadow) { this.shipShadow.setPosition(this.ship.x, this.ship.y + 18); }
            if (this.nameText) { this.nameText.setPosition(this.ship.x, this.ship.y - 42); }

            if (this.moveDir.x !== 0 || this.moveDir.y !== 0) {
                this.socket.emit('playerMovement', { x: this.ship.x, y: this.ship.y });
            }
        }
    }
}

function clearTarget() {
    selectedTarget = null;
    document.getElementById('target-hud').style.display = 'none';
}

function updateUI() {
    if (!myPlayerData) return;
    document.getElementById('ui-name').innerText = myPlayerData.name;
    document.getElementById('ui-lvl').innerText = myPlayerData.lvl;
    document.getElementById('ui-hp').innerText = myPlayerData.hp;
    document.getElementById('ui-mhp').innerText = myPlayerData.maxHp;
    document.getElementById('ui-sp').innerText = myPlayerData.sp;
    document.getElementById('ui-msp').innerText = myPlayerData.maxSp;
    
    document.getElementById('hp-bar').style.width = Math.floor((myPlayerData.hp / myPlayerData.maxHp) * 100) + '%';
    document.getElementById('sp-bar').style.width = Math.floor((myPlayerData.sp / myPlayerData.maxSp) * 100) + '%';

    document.getElementById('stat-point').innerText = myPlayerData.stats.statPoint;
    document.getElementById('val-str').innerText = myPlayerData.stats.str;
    document.getElementById('val-agi').innerText = myPlayerData.stats.agi;
    document.getElementById('val-vit').innerText = myPlayerData.stats.vit;
    document.getElementById('val-int').innerText = myPlayerData.stats.int;
    document.getElementById('val-dex').innerText = myPlayerData.stats.dex;
    document.getElementById('val-luk').innerText = myPlayerData.stats.luk;
    updateInventoryUI();
}

function updateInventoryUI() {
    if (!myPlayerData || !myPlayerData.inventory) return;
    let listEl = document.getElementById('inventory-list');
    listEl.innerHTML = '';
    myPlayerData.inventory.forEach(item => {
        let actionBtn = item.type === 'consumable' ? `<button class="use-btn" onclick="useItem('${item.id}')">ใช้</button>` : '';
        listEl.innerHTML += `<div class="item-row"><span>${item.name} (${item.count})</span> ${actionBtn}</div>`;
    });
}

function toggleModal(id) {
    let modal = document.getElementById(id);
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
}

function upgradeStat(statName) { if (globalSocket) globalSocket.emit('upgradeStat', statName); }
function useItem(itemId) { if (globalSocket) globalSocket.emit('useItem', itemId); }
function useActiveSkill() { if (game.scene.scenes[0]) game.scene.scenes[0].doAttack(true); }
function triggerAttack(isSkill) { if (game.scene.scenes[0]) game.scene.scenes[0].doAttack(isSkill); }

function sendChat() {
    let input = document.getElementById('chat-input');
    if (input.value.trim() !== '' && globalSocket) {
        globalSocket.emit('chatMessage', input.value);
        input.value = '';
    }
}

function showFloatingText(x, y, message, color, size = '12px') {
    let scene = game.scene.scenes[0];
    let txt = scene.add.text(x, y, message, { fontSize: size, fill: color, stroke: '#000', strokeThickness: 3.5 }).setOrigin(0.5);
    scene.tweens.add({ targets: txt, y: y - 40, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
}
