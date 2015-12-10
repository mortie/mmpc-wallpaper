var fs = require("fs");
var spawn = require("child_process").spawn;
var imageSize = require("image-size");

var conf = JSON.parse(fs.readFileSync("conf.json"));

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
	imageSize(path, function(err, dimensions) {
		if (err)
			throw err;

		this.dimensions = dimensions;
		this.type = this.getType();

		if (cb)
			cb();
	}.bind(this));
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
Pictures.prototype.update = function(cb) {
	console.log("Updating picture registry...");

	var all = [];
	var wide = [];
	var tall = [];
	var square = [];

	var files = fs.readdirSync(this.dir);

	var async = Async(files.length, function() {
		console.log("Updated.");

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
Pictures.prototype.setWallpaper = function() {
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
	});
};

var pictures = new Pictures(conf.path, function() {
	pictures.setWallpaper();
	setInterval(function() {
		pictures.setWallpaper();
	}, parseTimeString(conf.change_interval));
});

setInterval(function() {
	pictures.update();
}, parseTimeString(conf.registry_update_interval));
