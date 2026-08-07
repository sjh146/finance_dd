pipeline {
    agent any

    environment {
        // DB 자격증명은 Jenkins 크레덴셜(secret text 'aggelog-db-url')에서 주입
        // 설정: Jenkins → Manage Jenkins → Credentials → Add → Secret text
        DATABASE_URL = credentials('aggelog-db-url')
        REDIS_URL = 'redis://aggelog-redis:6379'
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'master', url: 'https://github.com/sjh146/finance_dd.git'
            }
        }
        stage('Install') {
            steps {
                sh 'npm ci'
                // Prisma 7: 클라이언트는 postinstall에 자동 생성되지 않음 — 명시적 generate 필요
                sh 'npx prisma generate'
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
