var gulp = require('gulp');
var debug = require('debug')('febu:gulpfile.js');
var minifyCss = require('gulp-minify-css');
var argv = require('yargs').argv;
var del = require('del');
var async = require('async');
var path = require('path');
var common = require('./module/common.js');
var Git = require('./module/git.js');
var util = require('./module/util.js');
var db = require('./module/db.js');
var Development = require('./module/development.js');
var Production = require('./module/production.js');

var repo;
var commit = argv.commit || 'HEAD';  // 检出相应版本
var release;
var src;
var build;
var source = [];
var project;
var timer;

var handleError = function(err) {
	if(handleError.busy) {
		return;
	}
	handleError.busy = true;
	console.error('发布失败: %s', err.message || err);
	closeDb(function() {
		process.exit(1);
	});
};

gulp.task('before', function(callback){
	if(!argv.repo) {
		return callback('请输入仓库地址，参数--repo');
	}
	repo = argv.repo;
	src = common.getCwd(repo, 'src');
	build = common.getCwd(repo, 'build');

	var initDB = function(cb) {
		db.open(function(){
			db.projects.find(repo, function(err, data){
				if(err) {
					db.close();
					return cb(err);
				} else if(!data) {
					db.close();
					return cb('请在数据库里初始化该项目 ' + repo);
				} else if(data.busy) {
					db.close();
					return cb('该项目正在发布，请稍后再试');
				}
				data.busy = true;
				data.development.web = fixPath(data.development.web);
				data.production.web = fixPath(data.production.web);
				project = data;
				db.projects.save(data, cb);
			});
		});
	};

	var git = new Git(repo);

	var clone = function(cb) {
		git.clone(function() {
			cb();
		});
	};

	var formatCommit = function(cb) {
		util.formatCommit(repo, commit, function(err, data) {
			commit = data;
			cb(err);
		});
	};

	async.series([initDB, clone, git.checkout.bind(git, 'master'), git.pull.bind(git), formatCommit], function(err) {
		clearTimeout(timer);
		callback(err);
	});

	timer = setTimeout(function() {
		callback('发布超时，请稍后重试');
	}, 240000);
})
.on('task_err', handleError);

gulp.task('clean', ['before'], function(){
	del([build], {force: true});
});

var closeDb = function(callback) {
	db.projects.find(repo, function(err, data){
		if(err) {
			return callback(err);
		}
		data.busy = false;
		db.projects.save(data, db.close.bind(db, callback));
	});
};

// project.development.web和project.production.web值最后需要一个/
var fixPath = function(href) {
	if(href.slice(-1) !== '/') {
		href += '/';
	}
	return href;
};

// 发布到测试环境
gulp.task('development', ['before'], function(callback){
	console.log('发布到测试环境 src commit=%s', commit);
	var dev = new Development(project);
	dev.db = db;
	dev.run(commit, function(err) {
		err ? callback(err) : closeDb(callback);
	});
})
.on('task_err', handleError);

// 发布到生产环境
gulp.task('production', ['before'], function(callback){
	console.log('发布到生产环境 src commit=%s', commit);
	var p = new Production(project);
	p.db = db;
	p.run(commit, function(err) {
		err ? callback(err) : closeDb(callback);
	});
})
.on('task_err', handleError);
