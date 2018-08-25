var fs = require("fs");
var spawn = require("child_process").spawn;
var imageSize = require("image-size");

var conf = JSON.parse(fs.readFileSync("conf.json"));

function thrImageSize(path, cb) {
	function update() {
		while (thrImageSize.count < thrImageSize.max && thrImageSize.queue.length > 0) {
			var obj = thrImageSize.queue.pop();
			thrImageSize.count += 1;
			setTimeout(function() {
				imageSize(obj.path, function(err, dimensions) {
					thrImageSize.count -= 1;
					update();
					obj.cb(err, dimensions);
				});
			}, thrImageSize.timeout);
		}
	}

	if (thrImageSize.count < thrImageSize.max) {
		thrImageSize.count += 1;
		imageSize(path, function(err, dimensions) {
			thrImageSize.count -= 1;
			update();
			cb(err, dimensions);
		});
	} else {
		thrImageSize.queue.push({ cb, path });
	}
}
thrImageSize.count = 0;
thrImageSize.defaultMax = thrImageSize.max = 5;
thrImageSize.timeout = thrImageSize.defaultTimeout = 500;
thrImageSize.queue = [];

function parseTimeString(str) {
	var total = 0;
	var num = 0;

	str.split(/[\s,]+/).forEach(function(token) {
		if (!isNaN(parseInt(token))) {
			num = parseInt(token);
		} else if (/seconds?/.test(token)) {
			total += num * 1000;
		} else if (/minutes?/.test(token)) {
			total += num * 1000 * 60;
		} else if (/hours?/.test(token)) {
			total += num * 1000 * 60 * 60;
		} else if (/days?/.test(token)) {
			total += num * 1000 * 60 * 60 * 24;
		}
	});

	return total;
}

function random(min, max) {
	return Math.floor(Math.random() * (max - min) + min);
}

function Async(n, func) {
	if (n == 0) {
		setTimeout(func, 0);
		return null;
	}

	var arr = [];
	return function(val) {
		if (val)
			arr.push(val);

		n -= 1;

		if (n === 0)
			func(arr);
	};
}

function Picture(path, cb) {
	this.path = path;
	thrImageSize(path, function(err, dimensions) {
		if (err)
			throw err;

		this.dimensions = dimensions;
		this.type = this.getType();

		if (cb)
			cb();
	}.bind(this));
}
Picture.prototype.serialize = function() {
	return {
		path: this.path,
		dimensions: this.dimensions,
		type: this.type,
	};
}
Picture.unserialize = function(obj) {
	let o = Object.create(Picture.prototype);
	o.path = obj.path;
	o.dimensions = obj.dimensions;
	o.type = obj.type;
	return o;
}
Picture.prototype.getType = function() {
	var dims = this.dimensions;
	var ratio = dims.width / dims.height;

	if (ratio > 1.2)
		return "wide";
	else if (ratio < 0.8)
		return "tall";
	else
		return "square";
};
Picture.prototype.scale = function(scaleFactor) {
	var scaled = spawn("convert", [
		this.path,
		"-resize", (scaleFactor * 100)+"%",
		"jpeg:-"
	]);

	return scaled.stdout;
};
Picture.prototype.combineWith = function(picture) {
	var scaleFactor = this.dimensions.height / picture.dimensions.height;

	var combined = spawn("convert", [
		"jpeg:-",
		this.path, "+append",
		"jpeg:-"
	]);
	picture.scale(scaleFactor).pipe(combined.stdin);

	return combined.stdout;
};

function Pictures(dir, cb) {
	this.dir = dir;

	this.all = [];
	this.wide = [];
	this.tall = [];
	this.square = [];

	this.update(cb);
}
Pictures.prototype.serialize = function() {
	return {
		dir: this.dir,
		all: this.all.map(function(pic) { return pic.serialize(); }),
		wide: this.wide.map(function(pic) { return pic.serialize(); }),
		tall: this.tall.map(function(pic) { return pic.serialize(); }),
		square: this.square.map(function(pic) { return pic.serialize(); }),
	};
}
Pictures.unserialize = function(obj) {
	var o = Object.create(Pictures.prototype);
	o.dir = obj.dir;
	o.all = obj.all.map(function(pic) { return Picture.unserialize(pic); });
	o.wide = obj.wide.map(function(pic) { return Picture.unserialize(pic); });
	o.tall = obj.tall.map(function(pic) { return Picture.unserialize(pic); });
	o.square = obj.square.map(function(pic) { return Picture.unserialize(pic); });
	return o;
}
Pictures.prototype.update = function(cb) {
	console.log("Updating picture registry...");

	var all = [];
	var wide = [];
	var tall = [];
	var square = [];

	var files = fs.readdirSync(this.dir);

	var interval = setInterval(function() {
		console.log("Still working on "+this.dir+": "+all.length+"/"+files.length);
	}.bind(this), 10000);

	var async = Async(files.length, function() {
		clearInterval(interval);
		console.log("Updated "+this.dir+".");

		this.all = all;
		this.wide = wide;
		this.tall = tall;
		this.square = square;
		if (cb)
			cb();
	}.bind(this));

	files.forEach(function(file) {
		var path = this.dir+"/"+file;

		if (file[0] === ".")
			return async();

		fs.stat(path, function(err, stat) {
			if (err)
				throw err;

			if (stat.isDirectory())
				return async();

			var picture = new Picture(path, function() {
				all.push(picture);

				if (picture.type === "wide")
					wide.push(picture);
				else if (picture.type === "tall")
					tall.push(picture);
				else if (picture.type === "square")
					square.push(picture);

				async();
			});
		});
	}.bind(this));
};
Pictures.prototype.getRandom = function(arr) {
	if (arr === undefined)
		arr = this.all;

	var i = random(0, arr.length - 1);
	return arr[i];
};
Pictures.prototype.setWallpaper = function(cb) {
	var picture = this.getRandom();

	if (!picture)
		return;

	var readStream;
	if (picture.type === "tall") {
		var picture2 = this.getRandom(this.tall);
		if (picture2) {
			readStream = picture.combineWith(picture2);
		} else {
			readStream = fs.createReadStream(picture.path);
		}
	} else {
		readStream = fs.createReadStream(picture.path);
	}

	var writeStream = fs.createWriteStream("background.jpg");
	readStream.pipe(writeStream);
	readStream.on("end", function() {
		var child = require("child_process").exec(conf.bg_changed_cmd);
		child.stdout.pipe(process.stdout);
		child.stderr.pipe(process.stderr);
		cb();
	});
};

function serialize(pictureses, file) {
	var obj = pictureses.map(function(p) { return p.serialize(); });
	var json = JSON.stringify(obj);
	fs.writeFileSync(file, json);
	console.log("Serialized to "+file+".");
}
function unserialize(file) {
	var json = fs.readFileSync(file);
	var obj = JSON.parse(json);
	let pictureses = obj.map(function(p) { return Pictures.unserialize(p); });
	console.log("Unserialized "+file+".");
	return pictureses;
}

function startChange(pictureses, updateImmediately) {
	let changeInterval = parseTimeString(conf.change_interval);
	thrImageSize.max = 1;
	thrImageSize.timeout = 1000;
	function change() {
		var pics;
		do {
			var r = Math.floor((Math.random() * pictureses.length));
			var pics = pictureses[r];
		} while (pics.all.length == 0);

		console.log("Changing to random pic in "+pics.dir+"...");
		pics.setWallpaper(function() {
			thrImageSize.max = thrImageSize.defaultMax;
			thrImageSize.timeout = thrImageSize.defaultTimeout;
			console.log("Changed.");
			setTimeout(change, changeInterval);
		});
	}
	change();

	let registryInterval = parseTimeString(conf.registry_update_interval);

	function updateRegistry() {
		console.log("Starting to update registry.");
		var async = Async(pictureses.length, function() {
			serialize(pictureses, "registry.json");
			setTimeout(updateRegistry, registryInterval);
		});
		pictureses.forEach(function(p) { p.update(async); });
	};

	if (updateImmediately)
		updateRegistry();
	else
		setTimeout(updateRegistry, registryInterval);
}

if (fs.existsSync("registry.json")) {
	let pictureses = unserialize("registry.json");
	startChange(pictureses, true);
} else {
	var subdirs = fs.readdirSync(conf.path).filter(function(x) { return x != "lost+found" });

	var pictureses = [];

	var async = Async(subdirs.length, function() {
		serialize(pictureses, "registry.json");
		startChange(pictureses, false);
	});

	subdirs.forEach(function(subdir) {
		var pics = new Pictures(conf.path+"/"+subdir, async);
		pictureses.push(pics);
	});
}
