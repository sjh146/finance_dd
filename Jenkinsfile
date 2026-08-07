pipeline {
    agent any

    environment {
        DATABASE_URL = 'postgresql://aggelog:@aggelog-postgres:5432/aggelog?schema=public'
        REDIS_URL = 'redis://aggelog-redis:6379'
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'master', url: 'file:///var/jenkins_home/repos/finance_dd.git'
            }
        }
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }
        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }
        stage('Unit Tests') {
            steps {
                sh 'npm test 2>&1 | tail -25'
            }
        }
        stage('Smoke Test') {
            steps {
                sh 'bash scripts/smoke-test.sh'
            }
        }
    }

    post {
        success {
            echo '🎉 PIPELINE GREEN: build + unit tests + smoke tests 모두 통과'
        }
        failure {
            echo '❌ PIPELINE RED: 테스트 실패 — 수정 후 재실행 필요'
        }
    }
}
